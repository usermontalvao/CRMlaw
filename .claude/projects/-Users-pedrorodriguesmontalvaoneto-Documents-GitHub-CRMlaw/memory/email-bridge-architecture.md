---
name: email-bridge-architecture
description: A ingestão de e-mails do CRM roda num serviço externo (Servidor-mail), não no repo do CRM
metadata:
  type: project
---

O módulo de e-mail do CRM (`src/components/EmailModule.tsx`, `src/services/email.service.ts`) só LÊ da tabela Supabase `email_messages`. A ingestão (IMAP → mailparser → insert) e o envio rodam num serviço externo separado:

- Repo: `/Users/pedrorodriguesmontalvaoneto/Documents/GitHub/Servidor-mail` (email-bridge, Node/TypeScript).
- Deploy: Portainer (Docker) no servidor, exposto via Cloudflare Tunnel em `email.jurius-api.com`. A edge function `email-bridge-send` do CRM encaminha envios para `BRIDGE_URL/send`.
- Arquivos-chave do bridge: `src/imap.ts` (recebimento/backfill), `src/store.ts` (`storeIncoming`/`storeOutgoing`, upload de anexos), `src/supabase.ts` (usa service_role, bypassa RLS).
- Anexos: `store.ts::uploadAttachments` sobe pro bucket `email-attachments` e grava metadados `{filename, content_type, size, path}` na coluna jsonb `attachments`. O CRM baixa via signed URL (`email.service.ts::attachmentUrl`).

Armadilha de deploy: `docker-compose.yml` usa tag de imagem versionada (`email-bridge:node22-vN`). Se a tag NÃO for bumpada, o Portainer reusa a imagem antiga em cache e o código novo não sobe. Bump a tag a cada mudança de imagem.

O `sync-emails` (edge function no repo do CRM) é só um STUB que lança erro — não faz ingestão. Não confundir com o bridge real.
