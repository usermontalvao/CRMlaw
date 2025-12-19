ALTER TABLE public.template_custom_fields
ADD COLUMN IF NOT EXISTS options JSONB;

ALTER TABLE public.template_custom_fields
ADD COLUMN IF NOT EXISTS "order" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_template_custom_fields_order
  ON public.template_custom_fields("order");
