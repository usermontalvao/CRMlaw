# Manutenção futura — segurança do webhook Nextcloud

## Situação atual

- A rotação de `NEXTCLOUD_WEBHOOK_SECRET` está **pendente, mas não é uma emergência comprovada**.
- O valor real do segredo não foi encontrado no código nem no histórico Git.
- Não trocar o segredo isoladamente: Supabase e Nextcloud precisam receber o mesmo valor.

## Quando rotacionar

Rotacione se o segredo:

- tiver sido enviado em conversa, e-mail ou ferramenta de IA;
- tiver aparecido em URL compartilhada, print ou log;
- for fraco, previsível ou reutilizado;
- tiver sido acessado por alguém que não deveria.

Sem esses sinais, faça a rotação em uma janela futura de manutenção.

## Procedimento curto

1. Confirmar acesso aos secrets do Supabase e à configuração do webhook no Nextcloud.
2. Gerar um segredo novo, longo e aleatório.
3. Atualizar `NEXTCLOUD_WEBHOOK_SECRET` no Supabase.
4. Atualizar imediatamente o mesmo segredo no webhook do Nextcloud.
5. Criar ou alterar um arquivo no Nextcloud.
6. Confirmar nos logs da function `nextcloud-webhook` que o evento foi aceito.

Se falhar, restaurar temporariamente o segredo anterior nos dois lados.

## Regra de segurança

Nunca registrar o valor do segredo em código, Git, documentação, chat, print ou log.
