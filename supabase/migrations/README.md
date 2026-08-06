# Migrations: por que o número do arquivo não bate com o do banco

A CLI do Supabase **não está linkada** neste repositório. As migrations são
aplicadas pelo MCP (`apply_migration`), e ele **ignora o timestamp do nome do
arquivo**: grava em `supabase_migrations.schema_migrations` uma `version` com o
horário UTC do momento da aplicação e o `name` que recebeu.

Consequência: procurar uma migration no histórico **pelo timestamp do arquivo
sempre dá "não encontrada"**. O casamento é pelo `name`, e por ele é 1:1.

Foi exatamente esse o falso positivo que gerou a suspeita de que
`20260805224000`, `20260806210000` e `20260806211000` não tinham sido aplicadas.
Elas foram — com outra `version`:

| Arquivo no repositório | `version` no banco | `name` no banco |
| --- | --- | --- |
| `20260805210000_presence_write_reduction.sql` | `20260806015440` | `presence_write_reduction` |
| `20260805210500_chat_rls_performance.sql` | `20260806015904` | `chat_rls_performance` |
| `20260805213000_preserve_last_seen_on_expiry.sql` | `20260806022412` | `preserve_last_seen_on_expiry` |
| `20260805220000_realtime_drop_unconsumed_tables.sql` | `20260806025916` | `realtime_drop_unconsumed_tables` |
| `20260805223000_broadcast_email_and_petitions.sql` | `20260806031023` | `broadcast_email_and_petitions` |
| `20260805224000_realtime_drop_email_and_petitions.sql` | `20260806231737` | `realtime_drop_email_and_petitions` |
| `20260805230000_index_usage_monitoring.sql` | `20260806032059` | `index_usage_monitoring` |
| `20260805235500_cron_history_retention.sql` | `20260806035352` | `cron_history_retention` |
| `20260806000500_email_folder_listing_indexes.sql` | `20260806035723` | `email_folder_listing_indexes` |
| `20260806001000_purge_cron_history_revoke_public.sql` | `20260806040230` | `purge_cron_history_revoke_public` |
| `20260806010000_email_bounce_flag.sql` | `20260806150451` | `email_bounce_flag` |
| `20260806020000_link_deadlines_to_intimations.sql` | `20260806182201` | `link_deadlines_to_intimations` |
| `20260806030000_whatsapp_messages_replica_identity.sql` | `20260806193710` | `whatsapp_messages_replica_identity` |
| `20260806210000_whatsapp_messages_broadcast.sql` | `20260806231703` | `whatsapp_messages_broadcast` |
| `20260806211000_whatsapp_raw_backfill.sql` | `20260806231723` | `whatsapp_raw_backfill` |
| `20260806234746_whatsapp_broadcast_hardening.sql` | `20260806234746` | `whatsapp_broadcast_hardening` |

Duas migrations existem **só no banco**, sem arquivo no repositório — aplicadas
direto pelo MCP e nunca versionadas:

| `version` | `name` |
| --- | --- |
| `20260806031208` | `broadcast_petitions_office_topic` |
| `20260806032218` | `index_report_reset_safe_v2` |

## Por que nada foi reaplicado nem inserido à mão

Os efeitos das três migrations sob suspeita foram comparados objeto a objeto com
o banco: policy, gatilhos, corpo das funções, publicação. **Batem exatamente** —
o corpo de `broadcast_whatsapp_message_changed()` no banco é idêntico, linha por
linha, ao do arquivo (o Postgres não guarda os comentários `--`, só isso difere).

Não há drift. Inserir linha em `schema_migrations` para "consertar" a aparência
seria inventar histórico; reaplicar o SQL seria trabalho sem efeito. A divergência
é de **convenção de nome**, não de estado.

## Convenção daqui para frente

Ao aplicar pelo MCP, **nomeie o arquivo com a `version` que o banco gravou**
(consulte `schema_migrations` logo após aplicar). Foi o que se fez com
`20260806234746_whatsapp_broadcast_hardening.sql`, e é por isso que ela é a
primeira linha da tabela acima em que os dois números coincidem.

Os arquivos anteriores **não foram renomeados de propósito**: eles já estão em
commits publicados, e renomeá-los mudaria arquivos de módulos (e-mail, cron,
índices) sem mudar comportamento nenhum. O mapa acima resolve a consulta.

Se um dia a CLI for linkada, o alinhamento se faz com
`supabase migration repair --status applied <version>` — nunca com `INSERT`
manual em `schema_migrations`.
