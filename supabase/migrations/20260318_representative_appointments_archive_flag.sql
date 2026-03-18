ALTER TABLE public.representative_appointments
ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.representative_appointments
ADD COLUMN IF NOT EXISTS diligence_location TEXT;

CREATE INDEX IF NOT EXISTS idx_representative_appointments_is_archived
  ON public.representative_appointments(is_archived);
