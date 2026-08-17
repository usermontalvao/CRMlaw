# MCP do Meta Ads no Codex

Esta integracao usa o pacote `meta-ads-mcp-server` fixado na versao `1.5.1`.
As ferramentas de escrita ficam desativadas por padrao.

## Credencial local

1. Copie `.env.meta-ads.example` para `.env.meta-ads.local`.
2. Preencha `META_ADS_ACCESS_TOKEN` com um token da Meta que tenha, no minimo,
   a permissao `ads_read`.
3. Mantenha `META_ADS_ENABLE_WRITE_TOOLS=false` durante a validacao inicial.

O arquivo `.env.meta-ads.local` termina em `.local` e ja e ignorado pelo Git.
O lancador nao imprime o token e o fornece ao servidor apenas em memoria.

## Validacao

Depois de salvar a credencial, reinicie o Codex e consulte os servidores MCP.
O servidor `meta_ads` deve iniciar e disponibilizar ferramentas de consulta de
contas, campanhas, anuncios e desempenho.

Ative escrita somente depois de validar a conta correta e revisar as aprovacoes:

```dotenv
META_ADS_ENABLE_WRITE_TOOLS=true
```

Para escrita, o token tambem precisa da permissao `ads_management`.
