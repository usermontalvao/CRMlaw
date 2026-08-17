-- A mensagem sobre documentos passa a ser UMA, depois que o cliente para de
-- mandar arquivo e a triagem leu todos.
--
-- Antes, cada arquivo era um turno e rendia um "Recebi seus arquivos e já estou
-- conferindo": em 14/08/2026 saíram três em 22 segundos, e nenhuma das três
-- podia dizer o que faltava, porque nada tinha sido lido ainda.
--
-- `doc_status_sent_at` é o que impede a repetição: só se fala de novo quando
-- chega arquivo mais NOVO do que a última vez que se falou.
alter table public.whatsapp_ai_sessions
  add column if not exists doc_status_sent_at timestamptz;
