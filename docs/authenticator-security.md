# Authenticator — segurança

O que está implementado, o que foi testado e o que **não** foi feito de
propósito. Se algo aqui divergir do código, o código está errado.

---

## 1. O segredo

| garantia | como |
|---|---|
| Nunca em texto puro no banco | AES-256-GCM com DEK próprio por credencial; o banco vê ciphertext, IV, DEK embrulhado e versão de chave |
| Chave mestra fora do banco | só em variável de ambiente da Edge Function; nem service role decifra |
| Ciphertext não é portátil | AAD amarra cada ciphertext ao id da linha — colar de uma credencial em outra falha |
| Adulteração é detectada | GCM autentica; um byte alterado derruba a abertura |
| Nunca sai para quem tem `USE` | o TOTP é calculado no servidor; a resposta tem `code`, não `secret` |
| Não vai para a extensão | a extensão não guarda segredo em lugar nenhum, nem em cache |
| Sai só com step-up | `EXPORT` e break-glass exigem senha reconferida + motivo, e auditam |

**O que um dump do banco entrega:** nomes de chave, quem é dono, com quem está
compartilhada, e blobs cifrados. Nenhum segredo, nenhum PIN utilizável.

---

## 2. O PIN administrativo

* Só a derivação é guardada: `PBKDF2-SHA512(600 000)` sobre
  `HMAC-SHA256(pepper, PIN)`, com salt de 16 bytes por administrador.
* O **pepper** mora em variável de ambiente. Quem levar o banco sem ele não
  consegue testar nem um candidato — é a proteção que mais importa para um
  segredo de 6 a 8 dígitos.
* Nunca retornado por API. Nunca exibido. Nem para quem o criou.
* PIN óbvio é recusado (`123456`, dígito repetido, e uma lista de comuns).
* Escada progressiva: 5 erros bloqueiam por 5 min, depois 15 min, 30 min, 1 h,
  3 h, 6 h, 12 h e 24 h. **A rodada não zera com o tempo** — quem já apanhou
  duas vezes não volta ao começo. Só o acerto zera.
* Durante o bloqueio nem o PIN certo passa.
* O PIN é **camada de autorização, não chave de criptografia**: ele não
  participa do envelope em ponto nenhum.

### Desvio consciente do "Argon2id de preferência"

O runtime das Edge Functions oferece WebCrypto, e não há Argon2 nele sem
carregar um wasm de terceiros **dentro do caminho de autenticação** — trocar
uma vantagem teórica de memória-dureza por uma dependência binária num ponto
crítico não compensa. Adotou-se PBKDF2-SHA512 com 600 mil iterações mais o
pepper, e o campo `kdf` guarda o nome do esquema
(`pbkdf2-sha512-600k+hmac-pepper.v1`). Migrar para Argon2id depois é subir a
versão e reescrever no primeiro uso, não uma migração de emergência.

---

## 3. Autorização

* **Administrador não é dono.** Não existe `if (admin) return tudo`. Um
  administrador vê a lista e revoga compartilhamento; para ver segredo, é
  break-glass.
* **A identidade vem da sessão**, jamais de `userId` no corpo. `owner_user_id`
  no corpo só é aceito de administrador, e vira auditoria.
* **Mass assignment fechado por lista branca** no `PATCH`. `owner_user_id`,
  `key_version`, `secret_ciphertext` e `secret_fingerprint` não entram por ali.
* **`403` e `404` são a mesma resposta** para credencial de terceiro.
* **A interface nunca é a barreira.** Todo botão escondido corresponde a um 403
  do servidor, e é isso que os testes verificam — chamando a API na mão.

---

## 4. Sessão

| risco | resposta |
|---|---|
| Senha guardada | não é guardada em lugar nenhum; existe só na requisição |
| Token sensível em `localStorage` | não se usa `localStorage` nem `chrome.storage.sync` na extensão |
| Token longo demais | access de 15 min; refresh de 30 dias que gira a cada uso |
| Refresh roubado | reuso de token já girado revoga a sessão inteira e audita |
| Usuário desligado | `profiles.is_active` conferido em toda chamada; a sessão é revogada na hora |
| Dispositivo perdido | lista de dispositivos com revogação, no popup e no CRM |
| Refresh concorrente | uma renovação por vez na extensão; no servidor, condição no hash antigo |

---

## 5. Rede

* **CORS por allow-list.** Nunca `*`. Origem desconhecida recebe 403 antes de
  qualquer processamento. A origem da extensão é fixa porque o `manifest.json`
  traz a chave pública — o ID não muda de máquina para máquina.
* **Sem cookie** em ponto algum ⇒ não há CSRF a defender.
* **HTTPS obrigatório** (o Supabase não serve HTTP), com `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` e
  `Cache-Control: no-store` em toda resposta.
* **Content-Type validado** e corpo limitado a 512 KB.
* Um WAF (Cloudflare, à frente do Supabase) barra payloads clássicos de SQLi na
  query string antes de a função ver. É camada extra, não a defesa: o que chega
  é tratado com escape próprio no filtro `or` do PostgREST.

---

## 6. Extensão

* Manifest V3. Permissões: **`storage` e `alarms`**. Só isso.
* Um único host alcançável: `…/functions/v1/totp-vault/*` — não o projeto
  inteiro.
* **Sem content script**, sem `tabs`, sem `activeTab`, sem `scripting`, sem
  `webRequest`. A extensão não lê página, não observa formulário, não vê senha
  de ninguém.
* CSP sem `unsafe-eval`, sem `unsafe-inline`, sem origem remota em `script-src`,
  `connect-src` restrito ao cofre.
* **Nada de código remoto.** Tudo empacotado, incluindo o leitor de QR.
* **Nada é copiado sozinho.** O código só vai para a área de transferência com
  clique. Não há histórico de códigos.
* **O popup não tem token.** Ele conversa por mensagem com o service worker;
  inspecionar o DevTools do popup não entrega sessão.
* **Nada de `innerHTML`** com dado do servidor — um nome de chave com
  `<img onerror=…>` continua sendo só um nome esquisito.
* Onze guardas viram teste em `extension/guardas.test.ts`, e rodam no
  `npm test`: se alguém acrescentar `tabs` ao manifest ou um `innerHTML` ao
  popup, o teste quebra.

---

## 7. QR e importação

* Decodificação **local**: `BarcodeDetector` nativo, com jsQR empacotado como
  reserva. A imagem não sai da máquina, não vai para serviço externo e não é
  guardada.
* O bitmap é liberado logo depois de decodificado; a URI segue direto para o
  servidor.
* QR corrompido, HOTP e MD5 viram mensagem explicando o que foi pulado — nunca
  credencial torta criada em silêncio.
* Importação limitada a 200 contas por vez.
* **Duplicidade é aviso, não bloqueio**: o usuário decide. A comparação usa a
  impressão digital com pepper, e só dentro do que aquela pessoa já enxerga —
  senão o aviso viraria um oráculo sobre o cofre alheio.

---

## 8. Log

Sanitização central em `_shared/totp/redact.ts`, com teste próprio:

* apaga por nome de campo (`password`, `secret`, `pin`, `token`, `code`,
  `authorization`, `data`, `uri`, `payload`, `dek`, `ciphertext`…);
* apaga `otpauth://…` e `otpauth-migration://…` dentro de texto solto;
* apaga sequência com cara de base32 mesmo sem nome de campo;
* é o único caminho para o console dentro do cofre.

`console.log(req.body)` não existe no código. O erro técnico fica no servidor,
sanitizado; o cliente recebe uma frase que não descreve criptografia nem
estrutura ("Não foi possível acessar esta credencial").

---

## 9. Rate limit

Reaproveita a tabela `security_rate_limits` que o CRM já usa.

| escopo | limite |
|---|---|
| `totp-login` | 20/5 min por IP · 10/5 min por e-mail (bloqueio 15 min) |
| `totp-refresh` | 120/5 min por IP |
| `totp-step-up` | 10/10 min por pessoa · 30/10 min por IP (bloqueio 30 min) |
| `totp-export` | 20/h por pessoa |
| `totp-admin-recover` | 30/h por pessoa · 60/h por IP |
| `totp-admin-pin-set` | 10/h por pessoa |

O teto de `admin-recover` é folgado **de propósito**: quem freia a tentativa às
cegas é a escada do PIN. Na primeira versão o limite era 5/h e disparava antes
da 5ª tentativa errada — a escada nunca chegava a existir, e um administrador
legítimo recuperando cinco chaves numa migração ficava uma hora de fora. O
teste que exercita a escada foi o que revelou isso.

---

## 10. O que foi tentado contra a solução

Cada linha abaixo é um teste que roda contra a função **em produção**
(`scripts/authenticator-e2e/`), não um raciocínio:

| ataque | resultado |
|---|---|
| IDOR: pedir código/detalhe/exportação de chave alheia | 403 nos quatro caminhos |
| Escalonamento: `owner_user_id` no corpo, sendo não-admin | 403 |
| Mass assignment: `PATCH` com dono, `key_version` e segredo novos | ignorados; dono e segredo intactos |
| Admin pedindo segredo pelo caminho normal | 403 no detalhe, no código e na exportação |
| Admin recuperando sem PIN configurado / PIN errado / sem step-up | recusado nos três, cada um auditado |
| Reusar o token de step-up | 401 (uso único), verificado em exportação e em recuperação |
| Reusar refresh token já girado | sessão inteira revogada |
| Token inventado, sem token, JWT falso, chave anônima como sessão | 401 |
| Ler as tabelas do cofre pelo PostgREST (anônimo E admin) | vazio nas cinco tabelas |
| Autoconceder permissão pela Data API | recusado |
| Força bruta do PIN | 4 recusas com contagem, 5ª bloqueia, PIN certo também barrado no bloqueio |
| Origem estranha no CORS | 403 antes de processar |
| Nome de chave com `<img onerror=…>` | aceito como texto; guarda de `innerHTML` no popup |
| Aspas, vírgula, ponto, parênteses, `%`, `\` na busca | 200, sem quebrar a consulta |
| QR corrompido / URI sem segredo válido | 400 |
| Usuário desativado com sessão aberta | 401 na hora, refresh recusado, login novo recusado |
| Segredo, PIN ou código na auditoria | nenhum, em 200 eventos conferidos |

---

## 11. O que NÃO foi feito, e por quê

* **Geração offline de código.** Exigiria entregar o segredo ao dispositivo,
  que é justamente o que `USE` não pode ter. Sem backend, a extensão diz
  "serviço indisponível".
* **Dois modelos criptográficos** (um para chave pessoal, outro para
  compartilhada). Mesma arquitetura para tudo — simplifica revogação,
  sincronização e recuperação, e evita um segundo caminho para auditar.
* **Limpeza automática do clipboard.** Não é confiável entre navegadores e
  atrapalha quem vai colar. Fica de fora.
* **Integração com a conta Google.** Não existe API para ler o Google
  Authenticator remotamente. O caminho é o QR de transferência, e é só isso que
  a extensão promete.
* **Segredo em cache para o popup abrir mais rápido.** Segurança ganha do
  desempenho; a velocidade veio do `/codes` em lote.

---

## 12. Resposta a incidente

**Suspeita de vazamento da chave mestra**

1. Gere `TOTP_VAULT_MASTER_KEY_V2` e publique junto com a v1.
2. `TOTP_VAULT_KEY_VERSION=2`, redeploy.
3. Rode `POST /admin/rewrap` em lotes até `remaining = 0`.
4. Só então remova a v1 do ambiente.
5. Nada disso recifra segredo — se a v1 foi realmente exposta **junto com um
   dump do banco**, trate os segredos como comprometidos e gire as contas nos
   respectivos provedores.

**Suspeita de PIN comprometido**

Configurações → Authenticator → Segurança → Alterar PIN (exige o PIN atual e a
senha). Confira `ADMIN_RECOVERY_*` na auditoria no período.

**Dispositivo perdido**

Popup → Sua conta → Revogar; ou Equipe → desativar o usuário, o que derruba
tudo dele na chamada seguinte.

**Suspeita de compartilhamento indevido**

Configurações → Authenticator → Compartilhamentos → Revogar. Vale
imediatamente. Depois, `ACCESS_GRANTED` na auditoria mostra quem concedeu e
quando.

## Correções de segurança de 24/08/2026

Uma revisão dirigida encontrou seis problemas. Todos foram corrigidos por
migration e redeploy, e cada um ganhou teste que falha se voltar.

### 1. Escalada de privilégio por `profiles` (crítico)

**A cadeia inteira:** a policy de UPDATE de `profiles` deixava qualquer pessoa
gravar a própria linha **sem restrição de coluna**. Como o cofre decide quem é
administrador lendo `profiles.role`/`badge`, um único comando pela Data API
bastava para chegar ao break-glass:

```
update profiles set role='Administrador' where user_id = auth.uid();
```

A mesma policy ainda dava a `advogado` — cargo comum — poder de escrever na
linha de terceiros.

**Correção:** gatilho `profiles_guarda_de_autoridade` recusa mudança em `role`,
`badge`, `is_active` e `user_id` para quem não é autoridade; a policy passou a
ser "eu mesmo OU administrador"; `TRUNCATE` saiu de `authenticated`.

**A armadilha que quase passou:** a primeira versão do gatilho era
`SECURITY DEFINER`, e dentro de DEFINER o `current_user` é o **dono** da função,
não quem chamou. O desvio `current_user in ('service_role','postgres')` dava
verdadeiro sempre e a guarda ficava desarmada. Foi o teste `escalada.mjs` que
pegou — a migration aplicada sem o teste teria dado falsa sensação de conserto.

### 2. Auditoria agora é fail-closed nas operações sensíveis

`writeAudit` engole erro de propósito: log que falha não deve derrubar um login.
Mas em EXPORT, break-glass, transferência e mudança de ACL isso significava
**segredo saindo sem registro**. Essas rotas passaram a usar `writeAuditStrict`,
que interrompe a operação (503) se o INSERT da auditoria falhar — e o registro
acontece **antes** do `return` que entrega o segredo.

O campo `reason` passou a ser higienizado: caractere de controle vira espaço (um
`\n` forjaria linha falsa no log) e o texto passa por `scrubText`, que redige
URI otpauth e blocos com cara de base32 — para o motivo nunca virar o vazamento
que ele existe para registrar.

### 3. `/admin/sessions` consultava coluna inexistente

A tabela tem `access_expires_at` e `refresh_expires_at`; o código pedia
`expires_at` e a rota respondia 500. Passou a usar `refresh_expires_at`, que é
o que de fato define até quando a sessão vive.

### 4. Refresh concorrente devolvia token fantasma

A rotação já tinha a condição certa no `WHERE`, mas **ninguém conferia quantas
linhas mudaram** — e o PostgREST não erra ao afetar zero linhas. O perdedor da
corrida recebia 200 com um par de tokens que nunca foi gravado. Agora a rotação
usa `.select('id')` e exige exatamente uma linha; qualquer outro caso é 401.

### 5. Transferência de propriedade virou atômica

Eram três escritas soltas (trocar dono, limpar ACL do novo dono, ajustar o
antigo). Viraram uma chamada a `totp_transfer_ownership`, que é uma transação.

### 6. Break-glass não abre chave na lixeira

Recuperar segredo de credencial `deleted` é restauração, não emergência. A rota
recusa com 409 e audita a recusa como `credential_deleted`.

### 7. Auditoria append-only de verdade

O gatilho cobria UPDATE e DELETE, mas era de LINHA — e `TRUNCATE` não dispara
gatilho de linha. O `service_role`, o mesmo papel que grava a auditoria, tinha o
privilégio de esvaziá-la. Agora ele só tem `INSERT` e `SELECT`, e um gatilho de
STATEMENT recusa TRUNCATE mesmo que o privilégio volte por engano.

## O PIN passou a ser o do sistema (24/08/2026)

O cofre nasceu com PIN próprio (`totp_admin_security`: PBKDF2-SHA512 com pepper
e escada de bloqueio progressiva) enquanto o CRM já tinha o dele
(`user_security_pins`, tela em **Meu Perfil → Segurança**).

Dois PINs para a mesma pessoa é uma promessa quebrada esperando acontecer: ela
troca um, o outro continua valendo, e o bloqueio de um não conversa com o do
outro. O cofre passou a usar o PIN do sistema.

### O que mudou na prática

| antes | agora |
|---|---|
| PIN próprio do cofre, 6–8 dígitos | PIN do sistema, 6 dígitos |
| escada progressiva (bloqueio crescente) | 5 tentativas → 15 min, o do CRM |
| cadastrado em Configurações → Authenticator | cadastrado em Meu Perfil → Segurança |
| contador de erro isolado | **contador compartilhado com o CRM** |

O contador compartilhado é consequência desejada, não efeito colateral: é o
mesmo segredo, então errar cinco vezes no cofre bloqueia o PIN no resto do
sistema também — e vice-versa.

### Como o caminho da extensão foi resolvido

`verify_security_pin` do CRM deriva a pessoa de `auth.uid()`, que **não existe**
no caminho da extensão (a sessão é um token opaco nosso, o cliente é
service_role). Por isso existe `totp_verify_security_pin(p_user_id, p_pin,
p_action)`: mesma tabela, mesmo hash, mesmo contador, mas recebendo o usuário
que a Edge Function já autenticou. Ela é executável **só** por service_role, e
`p_user_id` nunca vem do corpo do pedido — vem da sessão validada.

`POST /admin/security/pin` responde **410** apontando para a tela do perfil, em
vez de sumir, para versões antigas da extensão receberem explicação e não um 404
mudo. A variável `TOTP_VAULT_ADMIN_PIN_PEPPER` deixou de ser lida.
