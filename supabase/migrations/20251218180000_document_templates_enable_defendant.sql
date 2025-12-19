-- Add per-template toggle for showing 'Parte contrária / Réu' field

alter table public.document_templates
add column if not exists enable_defendant boolean not null default true;

update public.document_templates
set enable_defendant = true
where enable_defendant is null;
