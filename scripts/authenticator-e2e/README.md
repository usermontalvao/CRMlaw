# Teste ponta a ponta do cofre TOTP

Exercita a Edge Function `totp-vault` **em produção**, com contas descartáveis,
percorrendo os fluxos de aceite (A a H) e as tentativas de ataque descritas em
`docs/authenticator-security.md`.

Não há mock: o que passa aqui passou contra o serviço real.

## Antes de rodar

1. Crie as três contas de teste (uma vez), com o SQL de `seed.sql` — troque as
   senhas de exemplo por senhas fortes suas.
2. Exporte as senhas e as variáveis do Supabase:

```bash
export VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=...
export TOTP_E2E_PEDRO_SENHA=... TOTP_E2E_JOAO_SENHA=... TOTP_E2E_MARIA_SENHA=...
```

## Rodar

```bash
node scripts/authenticator-e2e/fase1.mjs
```

| arquivo | o que cobre |
|---|---|
| `fase1.mjs` | fluxos A–G, IDOR, escalonamento, mass assignment, sessões, auditoria |
| `fase2.mjs` | permissão EXPORT, arquivar, transferir, soft-delete |
| `fase3.mjs` | escada de bloqueio do PIN e caracteres especiais na busca |
| `fase4a.mjs` → desativar o usuário no banco → `fase4b.mjs` | fluxo H |
| `fase5.mjs` | caminho do CRM (JWT) e o cadeado da Data API |
| `reset-pin.sql` → `fase6.mjs` | painel de sessões e transferência administrativa |
| `ofensiva.mjs` | mass assignment, IDOR, CORS e payload hostil nas rotas de admin |
| `escalada.mjs` | escalada de privilégio em `profiles` (pela Data API, não pelo cofre) |
| `robustez.mjs` | refresh concorrente, motivo higienizado, break-glass em chave excluída |
| `pin-do-sistema.mjs` | o cofre usando o PIN do CRM em vez de um próprio |

As fases 1 e 2 gravam `estado.json` com os ids criados — 2 a 5 dependem dele.
Esse arquivo carrega tokens de sessão e por isso é ignorado pelo git.

### A fase 6 precisa do PIN zerado

A fase 3 termina de propósito com o PIN administrativo em bloqueio progressivo.
A fase 6 configura o PIN do zero, então **rode `reset-pin.sql` entre as duas** —
senão os primeiros passos falham com `Informe o PIN atual` e `429`.

**O contador de PIN é compartilhado com o CRM.** Desde que o cofre passou a usar
`user_security_pins`, tentativa errada numa suíte soma com a da suíte seguinte —
cinco no total e o PIN trava por 15 minutos, mesmo que cada suíte tenha errado
só uma vez. Rode `reset-pin.sql` **entre as fases**, não só antes da 6.

O mesmo vale para o rate limit do step-up, que também é real e acumula entre
suítes. Se aparecer `Muitas tentativas`, zere com `reset-pin.sql`
— ele limpa `security_rate_limits` junto. Um `429` no meio de uma bateria é o
limitador funcionando, não regressão.

```bash
node scripts/authenticator-e2e/fase6.mjs
node scripts/authenticator-e2e/ofensiva.mjs
node scripts/authenticator-e2e/escalada.mjs
node scripts/authenticator-e2e/robustez.mjs
```

### `escalada.mjs` roda pela porta do atacante

Ele não usa a Edge Function: fala **direto com o PostgREST**, com o JWT de um
usuário comum, porque era exatamente assim que a escalada de privilégio era
explorável. Exige `VITE_SUPABASE_ANON_KEY` no ambiente.

Armadilha ao ler o resultado: um `PATCH` recusado pela RLS devolve **204 com
zero linhas**, não um erro. Conferir o status ali dá falso verde — o que vale é
reler o valor e ver que ele não mudou.

A fase 6 cobre o teste que mais importa do painel administrativo: a
administradora **tentando transferir uma chave para si mesma**. Se isso passar,
ela vira dona — e dona exporta o segredo sem break-glass.

## Depois

`limpeza.sql` remove as chaves, sessões e contas de teste. As linhas de
**auditoria não são apagáveis** (a tabela é append-only, por projeto): elas
ficam, marcadas com as contas `@totp-vault-test.invalid`.
