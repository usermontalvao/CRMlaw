-- Índices para a listagem da caixa de entrada e de enviados.
--
-- `listMessages` (src/services/email.service.ts) filtra por pasta e ordena por
-- `sent_at DESC NULLS LAST, created_at DESC`, devolvendo 50 por página. Medido
-- antes, na caixa de entrada:
--
--   Seq Scan on email_messages (rows=11937, Rows Removed by Filter=704)
--   -> Sort (top-N heapsort) -> Limit 50
--   Buffers: shared hit=3012   Execution Time: 778 ms
--
-- Ou seja: para mostrar 50 e-mails o banco lia as 12.641 linhas da tabela e
-- ordenava 11.937. O índice existente `idx_email_messages_sent_at` não serve
-- porque é `sent_at DESC` puro — sem `NULLS LAST` (34 linhas têm sent_at nulo,
-- então a ordem não bate) e sem o filtro da pasta, que é o que descarta as
-- outras 704.
--
-- Os dois índices abaixo são parciais, com a mesma chave de ordenação da
-- consulta: o planejador percorre o índice já na ordem certa e para nas
-- primeiras 50 linhas, sem ler nem ordenar o resto.
--
-- Nada é removido aqui. `idx_email_messages_sent_at` continua, porque atende
-- outras consultas (listKnownAddresses, devoluções) que não têm o filtro de
-- pasta. Rollback: `drop index` nos dois nomes criados abaixo — índice não
-- guarda dado, derrubar não perde nada e a consulta volta ao Seq Scan.

-- Caixa de entrada: direction='inbound' e nenhum dos três marcadores.
create index if not exists idx_email_messages_inbox
  on public.email_messages (sent_at desc nulls last, created_at desc)
  where direction = 'inbound'
    and is_spam = false
    and is_trash = false
    and is_draft = false;

-- Enviados: mesma ideia, sem o filtro de spam (a pasta não o aplica).
create index if not exists idx_email_messages_sent_folder
  on public.email_messages (sent_at desc nulls last, created_at desc)
  where direction = 'outbound'
    and is_trash = false
    and is_draft = false;
