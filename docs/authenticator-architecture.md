# Authenticator — arquitetura

O cofre TOTP do escritório: uma extensão Chrome e uma área no CRM, sobre a
mesma base de usuários, o mesmo login e as mesmas permissões.

A regra que organiza tudo:

```
AUTENTICAÇÃO  ≠  AUTORIZAÇÃO  ≠  POSSE DO SEGREDO
```

Entrar prova **quem** é. A ACL diz **quais chaves**. Permissão `USE` devolve o
**código**, nunca o **segredo**. O segredo continua cifrado no cofre.

---

## Peças

```
┌─────────────────────┐        ┌─────────────────────┐
│ Extensão Chrome     │        │ CRM (React)         │
│ MV3, sem segredo    │        │ Configurações →     │
│ token opaco nosso   │        │ Authenticator       │
└──────────┬──────────┘        └──────────┬──────────┘
           │ X-Vault-Session              │ Authorization: Bearer <JWT>
           └───────────────┬──────────────┘
                           ▼
             ┌──────────────────────────────┐
             │ Edge Function `totp-vault`   │  ← ÚNICA porta
             │ service role + autorização   │
             │ refeita a cada chamada       │
             └──────────────┬───────────────┘
                            ▼
   totp_credentials · totp_permissions · totp_favorites
   totp_audit_logs  · totp_admin_security · totp_sessions
   (RLS ligada, ZERO policy — a Data API não devolve nada delas)
```

**Por que uma Edge Function em vez de RLS + PostgREST.** O cofre precisa
decifrar para gerar o código, e decifrar exige a chave mestra. Chave mestra em
função do banco significa chave mestra guardada perto do dado que ela protege.
Com a Edge Function, a chave vive só em variável de ambiente e o banco nunca
consegue abrir o que guarda — nem com service role, nem num dump.

Consequência de projeto: **não existe caminho alternativo**. As tabelas têm
`ENABLE`/`FORCE ROW LEVEL SECURITY` e nenhuma policy, e `anon`/`authenticated`
tiveram os privilégios revogados. Um administrador chamando o PostgREST direto
recebe lista vazia — verificado em teste.

---

## Autenticação

### Extensão

```
POST /auth/login  { email, senha, device_id, device_name }
        │
        ├── rate limit por IP e por e-mail
        ├── GoTrue confere a senha (mesma senha do CRM)
        ├── profiles.is_active precisa ser true
        └── emite par de tokens OPACOS (256 bits, guardados como SHA-256)
                access_token   15 min   → chrome.storage.session
                refresh_token  30 dias  → chrome.storage.local, gira a cada uso
```

A senha existe apenas dentro da requisição. Não é guardada, não vira variável
de módulo e o campo do formulário é limpo assim que a resposta chega.

Os tokens são **opacos, não JWT**. Um JWT do Supabase daria à extensão acesso à
Data API inteira; o token opaco só vale nesta função.

**Rotação com detecção de reuso.** Cada refresh gera um par novo e guarda o
hash do anterior. Apresentar um refresh já girado é sinal de token roubado: a
sessão inteira é revogada e vira `SESSION_REVOKED` na auditoria.

### CRM

O CRM já tem sessão do Supabase. Manda o JWT no `Authorization`, e a função
valida com `auth.getUser`. Uma linha `totp_sessions` do tipo `web` é criada
para pendurar o step-up e aparecer na lista de dispositivos.

### Desligar alguém

`profiles.is_active` é conferido **em toda chamada**. Desativar no CRM derruba o
acesso na chamada seguinte, revoga a sessão e audita — não se espera token
expirar.

---

## Criptografia (envelope)

```
segredo TOTP ──AES-256-GCM(DEK)──▶ secret_ciphertext + secret_iv
DEK aleatório ─AES-256-GCM(KEK)──▶ wrapped_dek + dek_iv + key_version
KEK = HKDF-SHA256(chave mestra, salt = id da credencial)
```

* **Um DEK por credencial.** Dois segredos iguais dão ciphertext diferente.
* **AAD amarra o ciphertext à linha.** `jurius-totp/secret/<id>/<versão>` entra
  como dado autenticado: copiar o `secret_ciphertext` de uma credencial para
  outra faz a decifragem falhar em vez de entregar o segredo da vizinha.
* **GCM autentica.** Um byte alterado no banco derruba a abertura.
* **Rotação sem recifrar segredo.** `rewrapDek` reabre o DEK sob a chave antiga
  e o embrulha sob a nova; o `secret_ciphertext` fica intacto.

### Impressão digital

`HMAC-SHA256(segredo)` com um *pepper* de ambiente próprio, usado só para
avisar "você já tem esta conta" na importação. Não é `sha256(segredo)` — sem o
pepper não existe dicionário possível. Fica numa variável separada da chave
mestra porque precisa continuar estável quando a mestra rotaciona.

---

## ACL

Uma linha por (credencial, usuário), com níveis **cumulativos**:

| nível     | vê nome | vê CÓDIGO | edita | compartilha | vê SEGREDO | transfere/exclui |
|-----------|:-------:|:---------:|:-----:|:-----------:|:----------:|:----------------:|
| `USE`     | ✓ | ✓ | — | — | — | — |
| `MANAGE`  | ✓ | ✓ | ✓ | ✓ | — | — |
| `EXPORT`  | ✓ | ✓ | ✓ | ✓ | ✓ (com step-up) | — |
| dono      | ✓ | ✓ | ✓ | ✓ | ✓ (com step-up) | ✓ |

O dono não tem linha na tabela: propriedade já é o topo. Ninguém concede acima
do próprio nível.

**Administrador não é dono.** Não existe `if (role === 'admin') return tudo`.
A régua está em `_shared/totp/acl.ts`, é função pura, e o teste que a exercita
verifica exatamente isso — inclusive que nenhum arranjo de flags dá segredo a
um administrador sem ACL.

Credencial **arquivada** não gera código; **excluída** (soft-delete) não faz
nada para ninguém, nem para o dono.

---

## Onde o código é calculado

No servidor. Sempre.

```
extensão ──GET /codes──▶ autoriza ──▶ decifra ──▶ gera TOTP ──▶ { code, expires_in }
```

Nunca `{ secret }`. É isto que faz `USE` funcionar sem entregar o segredo, e é
por isso que **não existe geração offline** para chave compartilhada: sem
backend, a extensão diz que o serviço está indisponível em vez de revelar algo.

O relógio de referência é o do **servidor** (`server_time` vem na resposta): o
contador da extensão não depende de o computador estar com a hora certa.

O TOTP é RFC 6238 (SHA1/SHA256/SHA512, 6 ou 8 dígitos, período configurável), e
os testes usam os vetores oficiais do apêndice B do RFC — os três algoritmos,
seis instantes cada — mais os dez códigos HOTP do RFC 4226.

---

## Break-glass

Recuperar segredo alheio **não** é administrar o cofre. É procedimento
excepcional, nesta ordem exata, e cada saída é auditada:

```
sessão válida → conta ativa → é administrador → motivo (≥15 caracteres)
   → rate limit → escada do PIN → PIN correto → step-up recente
   → decifra → ADMIN_RECOVERY_COMPLETED
```

O PIN é **camada de autorização, não chave**: ele não participa do envelope.
Se o PIN vazar, nada é decifrado — ainda faltam sessão de administrador ativo e
reautenticação.

Cada administrador tem o **seu** PIN (não é um PIN do escritório). Guarda-se só
a derivação; o PIN nunca volta por API, nem para quem o criou.

**Step-up** é reautenticação: a senha do CRM, validada no servidor, gerando um
token de 5 minutos, **de uso único**, amarrado à sessão. Não é "lembrar que
digitei a senha" — gastar o token impede reaproveitar a mesma confirmação numa
segunda recuperação.

---

## Auditoria

`totp_audit_logs` é append-only de verdade: um gatilho recusa `UPDATE` e
`DELETE`, inclusive para service role.

Eventos: `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `SESSION_REVOKED`,
`STEP_UP_COMPLETED`, `STEP_UP_FAILED`, `CREDENTIAL_CREATED/UPDATED/DELETED`,
`CREDENTIAL_TRANSFERRED`, `ACCESS_GRANTED/REVOKED/DENIED`, `CODE_ACCESSED`,
`EXPORT_REQUESTED/COMPLETED`, `IMPORT_COMPLETED`, `ADMIN_VAULT_LISTED`,
`ADMIN_PIN_CREATED/CHANGED/CHANGE_FAILED`,
`ADMIN_RECOVERY_REQUESTED/COMPLETED/FAILED`, `KEY_ROTATION_BATCH`.

Campos: ator, alvo, credencial, IP, user-agent, sessão, motivo,
`metadata_safe`, data.

**Nunca entram**: segredo, código TOTP, PIN, senha, token. A garantia não é
disciplina — todo `metadata_safe` passa por `redact()`, que apaga por nome de
campo e também limpa URI `otpauth://` e sequência com cara de base32 dentro de
texto solto.

`CODE_ACCESSED` é registrado **uma vez por chave a cada 15 minutos**. De 30 em
30 segundos a auditoria viraria ruído e deixaria de servir para auditar.

---

## Arquivos

| onde | o quê |
|---|---|
| `supabase/migrations/20260824090000_totp_vault.sql` | tabelas, índices, RLS fechada, append-only |
| `supabase/migrations/20260824090500_totp_vault_sessions_web.sql` | sessão do CRM (step-up) |
| `supabase/functions/totp-vault/index.ts` | a API inteira |
| `supabase/functions/_shared/totp/base32.ts` | Base32 RFC 4648 |
| `supabase/functions/_shared/totp/totp.ts` | HOTP/TOTP RFC 4226/6238 |
| `supabase/functions/_shared/totp/otpauth.ts` | `otpauth://` e o protobuf do Google Authenticator |
| `supabase/functions/_shared/totp/vault-crypto.ts` | envelope, chaveiro, rotação, impressão digital |
| `supabase/functions/_shared/totp/acl.ts` | a régua de autorização (pura) |
| `supabase/functions/_shared/totp/pin.ts` | derivação do PIN e escada de bloqueio (pura) |
| `supabase/functions/_shared/totp/redact.ts` | sanitização de log |
| `src/services/authenticator.service.ts` | cliente do CRM |
| `src/components/AuthenticatorSettings.tsx` | Configurações → Authenticator |
| `extension/` | a extensão MV3 |

---

## API

Base: `https://<projeto>.supabase.co/functions/v1/totp-vault`

| método | rota | quem |
|---|---|---|
| `GET`    | `/health` | público (só diz que subiu) |
| `POST`   | `/auth/login` `/auth/refresh` | público (com rate limit) |
| `POST`   | `/auth/logout` `/auth/step-up` | autenticado |
| `GET`    | `/auth/me` `/auth/sessions` | autenticado |
| `DELETE` | `/auth/sessions/:id` | dono da sessão, ou admin |
| `GET`    | `/credentials` | autenticado (só o que a ACL permite) |
| `POST`   | `/credentials` | autenticado |
| `GET`/`PATCH`/`DELETE` | `/credentials/:id` | conforme ACL |
| `GET`    | `/credentials/:id/code` | `USE`+ |
| `GET`/`POST` | `/codes` | `USE`+ (lote — é o que faz o popup abrir rápido) |
| `POST`   | `/credentials/:id/favorite` | `USE`+ |
| `POST`   | `/credentials/:id/transfer` | dono + step-up |
| `POST`   | `/credentials/:id/export` | `EXPORT`+ motivo + step-up |
| `GET`/`POST` | `/credentials/:id/permissions` | `MANAGE`+ |
| `DELETE` | `/credentials/:id/permissions/:userId` | `MANAGE`+, ou admin |
| `POST`   | `/import` | autenticado (`mode: analyze \| commit`) |
| `GET`    | `/users/search?q=` | autenticado |
| `GET`    | `/admin/credentials` `/admin/audit` `/admin/security` | administrador |
| `GET`    | `/admin/sessions` | administrador |
| `POST`   | `/admin/security/pin` | administrador + step-up |
| `POST`   | `/admin/recover` | administrador + motivo + PIN + step-up |
| `POST`   | `/admin/transfer` | administrador + motivo + PIN + step-up + **destino ≠ ele mesmo** |
| `POST`   | `/admin/rewrap` | administrador + step-up |

Derrubar o dispositivo de outra pessoa **não** tem rota própria: usa o mesmo
`DELETE /auth/sessions/:id` que o dono usa para derrubar o próprio. Quem separa
os dois casos é o servidor, que sabe de quem é a sessão — não um endereço
diferente escolhido pela tela.

### Por que a transferência administrativa custa o mesmo que o break-glass

Trocar o dono de uma chave dá ao novo dono o direito de **exportar o segredo**
(`OWNER` fica acima de `EXPORT` na régua). Um administrador que pudesse
transferir livremente teria, portanto, um atalho para o segredo: transferir
para si mesmo e exportar, sem nunca passar pela recuperação de emergência.

Por isso `/admin/transfer` cobra motivo, PIN e step-up — e `adminMayReceiveOwnership`
recusa, como regra pura testada, qualquer transferência em que o destino seja o
próprio administrador.

`403` e `404` são a **mesma resposta** para credencial de terceiro: quem não
pode não descobre nem que ela existe.
