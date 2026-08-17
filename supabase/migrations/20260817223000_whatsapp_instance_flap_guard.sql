-- Canal que pisca não é canal fora do ar.
--
-- A Evolution manda um `connection.update` a cada respiro do socket. Quando a
-- sessão do número está sendo disputada (outro cliente logado na mesma conta),
-- ela oscila open → close → connecting VÁRIAS VEZES POR SEGUNDO, mesmo com as
-- mensagens entrando e saindo normalmente. O CRM gravava cada um desses eventos
-- direto em `status` — 700+ escritas por hora no mesmo registro — e a inbox
-- acusava "esta conversa não vai enviar" de segundo em segundo num canal que
-- estava entregando.
--
-- Estas duas colunas dão memória ao estado, para o status parar de ser a foto do
-- último milissegundo:
--   · last_open_at             — quando vimos o canal ABERTO pela última vez.
--     Enquanto for recente, uma leitura ruim é piscada, não queda.
--   · last_reconnect_attempt_at — quando o CRM mandou /instance/connect.
--     Reconectar por cima de um socket vivo cria um SEGUNDO socket, que derruba
--     o primeiro: sem carência, a tentativa de socorro virava a própria causa.
alter table whatsapp_instances
  add column if not exists last_open_at timestamptz,
  add column if not exists last_reconnect_attempt_at timestamptz;

comment on column whatsapp_instances.last_open_at is
  'Última vez que a Evolution reportou a instância aberta. Base da carência anti-piscada.';
comment on column whatsapp_instances.last_reconnect_attempt_at is
  'Última vez que o CRM pediu /instance/connect. Segura o intervalo entre tentativas.';

-- Canal conectado hoje já foi visto aberto: sem semear, a primeira piscada depois
-- do deploy cairia na regra "nunca esteve aberto" e derrubaria o status na hora.
update whatsapp_instances
   set last_open_at = coalesce(connected_at, updated_at, now())
 where status = 'connected'
   and last_open_at is null;
