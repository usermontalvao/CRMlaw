-- A triagem documental do WhatsApp precisa saber QUANDO julgou e QUANTAS vezes.
--
-- Sem essas duas colunas, um veredito `no_match` era definitivo: o cron lia só
-- `doc_intake_status IS NULL`. E o veredito depende da lista de itens pendentes
-- no instante da leitura — em 14/08/2026 dois documentos legítimos (o print do
-- bloqueio e a CNH, mensagens 9ffa4f6e e e8afca60) foram julgados contra uma
-- lista que já não os continha e ficariam perdidos para sempre.
--
-- `doc_intake_at`       — quando o veredito atual foi escrito, para comparar
--                         com a criação das solicitações abertas;
-- `doc_intake_attempts` — o freio: no máximo três leituras por arquivo, para
--                         que uma foto que não é documento nenhum não vire
--                         chamada de visão a cada três minutos por seis horas.
alter table public.whatsapp_messages
  add column if not exists doc_intake_at timestamptz,
  add column if not exists doc_intake_attempts integer not null default 0;

-- O cron varre por status + janela de tempo. Índice parcial: só as linhas que
-- ainda podem entrar na fila, que são pouquíssimas perto da tabela inteira.
create index if not exists idx_whatsapp_messages_doc_intake_fila
  on public.whatsapp_messages (wa_timestamp)
  where direction = 'in'
    and type in ('image', 'document')
    and (doc_intake_status is null or doc_intake_status = 'no_match');
