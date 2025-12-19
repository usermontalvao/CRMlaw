ALTER TABLE public.template_custom_fields
ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;
