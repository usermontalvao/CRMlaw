-- Marca de devolução (bounce) gravada na linha, em vez de procurada no corpo.
--
-- `listBounceMessages` (src/services/email.service.ts) procurava as devoluções
-- assim: `from_address ilike '%mailer-daemon%' OR ... OR body_text ilike
-- '%Final-Recipient:%'`. Nenhum desses termos é indexável (todos começam com
-- `%`), então o banco lia as 12.672 linhas E descomprimia o `body_text` de
-- todas elas. Medido em 16 h de produção (pg_stat_statements):
--
--   39 chamadas · 1.468 ms de média · 1.765.127 blocos lidos
--   ≈ 45 mil blocos (350 MB) de buffer por chamada — para achar 2 linhas.
--
-- E a consulta roda a cada troca de pasta na tela de e-mail.
--
-- A coluna gerada abaixo aplica exatamente o mesmo teste, mas UMA vez, na
-- escrita da linha. O índice parcial guarda só as devoluções — hoje 2 linhas —
-- então a busca deixa de ser varredura e passa a ser leitura de índice.
--
-- `coalesce(..., false)`: sem ele, uma linha com `from_address` e `body_text`
-- nulos daria NULL em vez de false, e NULL nunca entra num índice parcial
-- `where is_bounce` — funcionaria igual, mas a coluna mentiria ao ser lida.
--
-- Custo de aplicar: `ADD COLUMN ... STORED` reescreve a tabela (185 MB com o
-- TOAST) sob ACCESS EXCLUSIVE. São poucos segundos neste tamanho, mas a caixa
-- de e-mail fica travada durante a reescrita — aplicar fora do horário de pico.
--
-- Rollback: `alter table public.email_messages drop column is_bounce;` (o
-- índice cai junto). A consulta antiga volta a funcionar sem mais nada.

alter table public.email_messages
  add column if not exists is_bounce boolean
  generated always as (
    coalesce(
      direction = 'inbound'
      and is_draft = false
      and (
        from_address ilike '%mailer-daemon%'
        or from_address ilike '%postmaster%'
        or from_address ilike '%mail-daemon%'
        or body_text like '%Final-Recipient:%'
        or body_text like '%Diagnostic-Code:%'
      ),
      false
    )
  ) stored;

comment on column public.email_messages.is_bounce is
  'Aviso de devolução (DSN): remetente MAILER-DAEMON/postmaster ou relatório RFC 3464 no corpo. Calculado na escrita para a busca não precisar varrer body_text.';

-- Mesma chave de ordenação da consulta (sent_at desc nulls last), para o
-- planejador sair do índice já na ordem certa.
create index if not exists idx_email_messages_bounce
  on public.email_messages (sent_at desc nulls last)
  where is_bounce;
