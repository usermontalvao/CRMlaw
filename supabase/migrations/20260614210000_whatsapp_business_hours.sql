-- Fase N: horários de atendimento e mensagem de ausência por canal

-- Configurações de ausência no próprio canal
ALTER TABLE whatsapp_instances
  ADD COLUMN IF NOT EXISTS absence_message TEXT,
  ADD COLUMN IF NOT EXISTS absence_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- Horários por canal (dia da semana 0=Dom … 6=Sab)
CREATE TABLE IF NOT EXISTS whatsapp_business_hours (
  id            UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id   UUID       NOT NULL REFERENCES whatsapp_instances(id) ON DELETE CASCADE,
  day_of_week   SMALLINT   NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME       NOT NULL DEFAULT '08:00',
  end_time      TIME       NOT NULL DEFAULT '18:00',
  is_active     BOOLEAN    NOT NULL DEFAULT TRUE,
  UNIQUE (instance_id, day_of_week)
);

ALTER TABLE whatsapp_business_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY bh_staff ON whatsapp_business_hours
  FOR ALL TO authenticated
  USING  (public.is_office_staff())
  WITH CHECK (public.is_office_staff());

-- Seed: segunda a sexta 08h–18h para todas as instâncias existentes
INSERT INTO whatsapp_business_hours (instance_id, day_of_week, start_time, end_time, is_active)
SELECT id, g.dow, '08:00', '18:00', (g.dow BETWEEN 1 AND 5)
FROM whatsapp_instances, generate_series(0,6) AS g(dow)
ON CONFLICT DO NOTHING;
