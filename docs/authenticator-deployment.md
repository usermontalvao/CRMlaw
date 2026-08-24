# Authenticator — implantação

## 1. Variáveis de ambiente

Todas vivem nos **secrets da Edge Function** (Supabase), nunca no repositório e
nunca no banco.

| variável | obrigatória | o que é |
|---|:--:|---|
| `TOTP_VAULT_MASTER_KEY_V1` | sim | chave mestra v1 — 32 bytes em base64 ou hex |
| `TOTP_VAULT_KEY_VERSION` | não | versão ativa (padrão: a mais alta carregada) |
| `TOTP_VAULT_FINGERPRINT_PEPPER` | sim | 32 bytes; pepper da impressão digital de duplicidade |
| `TOTP_VAULT_ADMIN_PIN_PEPPER` | sim | 32 bytes; pepper da derivação do PIN |
| `TOTP_VAULT_ALLOWED_ORIGINS` | sim | origens extras separadas por vírgula — é aqui que entra `chrome-extension://<id>` |
| `TOTP_VAULT_MASTER_KEY_V2`, `_V3`… | não | chaves de rotação |
| `TOTP_VAULT_MASTER_KEY` | não | nome legado, lido como v1 |

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são injetadas
pelo próprio Supabase.

Origens já aceitas sem configuração: `https://jurius.com.br`,
`https://www.jurius.com.br`, `http://localhost:5173`, `http://localhost:3000`.

### Gerar e publicar

```bash
umask 077
{
  echo "TOTP_VAULT_MASTER_KEY_V1=$(openssl rand -base64 32)"
  echo "TOTP_VAULT_KEY_VERSION=1"
  echo "TOTP_VAULT_FINGERPRINT_PEPPER=$(openssl rand -base64 32)"
  echo "TOTP_VAULT_ADMIN_PIN_PEPPER=$(openssl rand -base64 32)"
} > .env.totp-vault.local

npx supabase secrets set --project-ref <ref> --env-file .env.totp-vault.local
```

> **Guarde `.env.totp-vault.local` no gerenciador de segredos do escritório.**
> Sem `TOTP_VAULT_MASTER_KEY_V1` nenhuma chave do cofre volta a ser decifrada —
> nem por nós, nem pelo Supabase. O arquivo já está no `.gitignore`.

## 2. Banco

Duas migrations, nesta ordem:

```
supabase/migrations/20260824090000_totp_vault.sql
supabase/migrations/20260824090500_totp_vault_sessions_web.sql
```

Elas criam `totp_credentials`, `totp_permissions`, `totp_favorites`,
`totp_audit_logs`, `totp_admin_security` e `totp_sessions`; ligam RLS **sem
policy**; revogam privilégio de `anon`/`authenticated`; instalam o gatilho
append-only da auditoria; e acrescentam o módulo `authenticator` à matriz de
`role_permissions` (marcado só para cargos administrativos).

Nada de tabela existente é alterado.

## 3. Edge Function

```bash
npx supabase functions deploy totp-vault --project-ref <ref> --no-verify-jwt
```

`--no-verify-jwt` é **obrigatório**: a extensão autentica com token opaco
próprio no cabeçalho `X-Vault-Session`, não com JWT. A função faz a própria
verificação em toda rota que não seja `/health`, `/auth/login` e
`/auth/refresh`.

Fumaça depois de subir:

```bash
curl -s https://<ref>.supabase.co/functions/v1/totp-vault/health
# {"ok":true,"key_versions":1}

curl -s -o /dev/null -w '%{http_code}\n' https://<ref>.supabase.co/functions/v1/totp-vault/credentials
# 401
```

`200` no `/health` prova que o módulo carregou **e** que existe ao menos uma
chave mestra. `401` no `/credentials` prova que a autenticação está de pé.

## 4. Extensão

O ID é **fixo** (`ipapgfacphjdohnonhjkgbcdmojelbjb`) porque o `manifest.json`
traz a chave pública. A chave privada correspondente está em
`extension-signing-key.pem`, fora do git — ela só é necessária para empacotar
um `.crx`; para uso interno, carregar sem empacotar é suficiente.

### Instalar (por máquina)

1. `chrome://extensions`
2. Ligue **Modo do desenvolvedor**
3. **Carregar sem compactação** → escolha a pasta `extension/`
4. Confira que o ID é `ipapgfacphjdohnonhjkgbcdmojelbjb`
5. Fixe o ícone na barra

### Distribuir para o escritório

Duas opções:

* **Política do Chrome (recomendado).** Publique o `.crx` num endereço interno
  e use `ExtensionInstallForcelist` com `<id>;<url do update manifest>`.
* **Chrome Web Store, não listada.** Ao subir para a Store o ID muda para o da
  Store; acrescente a nova origem em `TOTP_VAULT_ALLOWED_ORIGINS` **antes** de
  distribuir, senão o login falha com 403 de origem.

### Trocar o projeto Supabase

Três lugares, e todos precisam mudar juntos:

1. `extension/src/lib/config.js` → `VAULT_BASE_URL`
2. `extension/manifest.json` → `host_permissions`
3. `extension/manifest.json` → `content_security_policy.connect-src`

## 5. Primeiro administrador

1. CRM → **Configurações → Authenticator → Segurança**
2. **Configurar PIN** — pede o novo PIN (6 a 8 dígitos) e a sua senha do CRM
3. Repita com um **segundo** administrador: com um único PIN configurado, a
   ausência dessa pessoa trava toda recuperação de emergência. A própria tela
   avisa enquanto houver só um.

## 6. Rotação da chave mestra

```bash
# 1. publique a v2 AO LADO da v1 — as duas precisam coexistir
npx supabase secrets set --project-ref <ref> \
  TOTP_VAULT_MASTER_KEY_V2="$(openssl rand -base64 32)" \
  TOTP_VAULT_KEY_VERSION=2

# 2. redeploy para a função recarregar o chaveiro
npx supabase functions deploy totp-vault --project-ref <ref> --no-verify-jwt
```

3. No CRM, chame `POST /admin/rewrap` em lotes (o retorno traz `remaining`)
   até `remaining = 0`. Cada lote exige step-up e vira `KEY_ROTATION_BATCH` na
   auditoria.
4. **Só então** remova `TOTP_VAULT_MASTER_KEY_V1`. Enquanto houver credencial
   com `key_version = 1`, apagar a v1 a torna ilegível.

O `secret_ciphertext` não é recriado: só o DEK muda de embrulho. Rotacionar é
barato e não tem janela de indisponibilidade.

**Não rotacione `TOTP_VAULT_FINGERPRINT_PEPPER`** junto: ele só é usado para
avisar duplicidade, e trocá-lo faz as impressões digitais antigas deixarem de
casar (nada quebra — o aviso apenas para de aparecer para o que já existia).

## 7. Teste ponta a ponta

`scripts/authenticator-e2e/` roda contra o ambiente real. Veja o README de lá.

## 8. Retenção

Excluir uma chave é **soft-delete**: a linha fica com `status = 'deleted'`,
carimbada com quem excluiu, quando e por quê, e some das listagens comuns
(o administrador ainda a vê marcando "mostrar excluídas"). Não há expurgo
automático — decidir por quanto tempo guardar é política do escritório, e o
`DELETE` físico continua disponível por SQL quando essa decisão existir.

`totp_audit_logs` cresce ~1 linha por chave a cada 15 minutos de uso, mais os
eventos administrativos. Um escritório com 50 chaves em uso constante gera algo
como 0,5 MB/mês. Se um dia isso incomodar, o caminho é particionar por data —
não apagar, que o gatilho impede.
