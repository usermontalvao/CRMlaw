-- Habilita Realtime na tabela processes para atualizações automáticas no frontend
-- (cron DJEN/DataJud → Supabase → WebSocket → UI)
ALTER PUBLICATION supabase_realtime ADD TABLE processes;
