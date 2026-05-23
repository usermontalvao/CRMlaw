-- Tabela de notificações de andamentos processuais (Publicações e Andamentos)
CREATE TABLE IF NOT EXISTS process_notifications (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  process_id     UUID        REFERENCES processes(id) ON DELETE CASCADE,
  process_code   TEXT        NOT NULL,
  client_name    TEXT,
  source         TEXT        NOT NULL DEFAULT 'datajud' CHECK (source IN ('datajud','djen')),
  type           TEXT        NOT NULL DEFAULT 'outro'   CHECK (type   IN ('sentenca','decisao','despacho','citacao','recurso','intimacao','audiencia','outro')),
  title          TEXT        NOT NULL,
  description    TEXT,
  movement_date  TIMESTAMPTZ,
  read_at        TIMESTAMPTZ DEFAULT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (process_id, source, movement_date, title)
);

CREATE INDEX IF NOT EXISTS idx_proc_notif_process_id    ON process_notifications (process_id);
CREATE INDEX IF NOT EXISTS idx_proc_notif_read_at       ON process_notifications (read_at);
CREATE INDEX IF NOT EXISTS idx_proc_notif_movement_date ON process_notifications (movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_proc_notif_source        ON process_notifications (source);

ALTER TABLE process_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated can select" ON process_notifications
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated can insert" ON process_notifications
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated can update" ON process_notifications
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "authenticated can delete" ON process_notifications
  FOR DELETE TO authenticated USING (true);
