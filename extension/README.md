# Jurius Authenticator — extensão Chrome

Códigos 2FA do escritório, com as **mesmas contas e permissões do CRM**.

Não há cadastro separado, não há segredo no dispositivo, e não há geração
offline para chave compartilhada — o código vem do servidor, que confere a ACL
a cada pedido.

## Instalar

1. `chrome://extensions`
2. Ligue **Modo do desenvolvedor**
3. **Carregar sem compactação** → escolha esta pasta
4. O ID tem de ser `ipapgfacphjdohnonhjkgbcdmojelbjb` (ele é fixo por causa da
   chave pública no `manifest.json`, e o cofre só aceita essa origem)
5. Fixe o ícone na barra do Chrome

## Estrutura

```
manifest.json            MV3: storage + alarms, um único host, CSP fechada
src/background/          service worker — o ÚNICO lugar com token e com rede
src/lib/config.js        endereço do cofre
src/lib/session.js       onde cada token mora (e o que nunca é guardado)
src/lib/api.js           cliente HTTP, renovação e rotação
src/lib/qr.js            leitura de QR, 100% local
src/popup/               a interface
src/options/             o que a extensão guarda e o que ela nunca guarda
vendor/jsqr.js           leitor de QR empacotado (MIT), reserva do BarcodeDetector
guardas.test.ts          as promessas acima viradas em teste (roda no npm test)
icons/                   gerados por scripts/render-authenticator-icons.mjs
```

## O que ela faz

* lista as chaves com código, contador e barra, e copia com um clique;
* busca instantânea, favoritos e marca de compartilhamento;
* cadastro manual, colar `otpauth://` e importar QR (inclusive o de
  transferência do Google Authenticator, com seleção conta a conta);
* compartilhar com usuário do CRM em três níveis, e revogar;
* exportar o segredo (só com permissão `EXPORT`, motivo e senha reconferida);
* transferir propriedade;
* ver e revogar dispositivos conectados.

## O que ela NÃO faz, de propósito

* não guarda a sua senha;
* não guarda segredo TOTP — nem em cache, nem por um instante;
* não usa `localStorage` nem `chrome.storage.sync`;
* não copia código sozinha;
* não lê página, não observa formulário, não acessa abas;
* não carrega código remoto e não usa `eval`;
* não gera código sem servidor (isso exigiria ter o segredo aqui).

## Desenvolvimento

Não há build: são módulos ES carregados direto. Depois de editar, clique em
**Atualizar** na página de extensões.

Para apontar para outro projeto Supabase, mude os **três**:
`src/lib/config.js`, `host_permissions` e `connect-src` do manifest.

Os testes rodam com o resto do projeto:

```bash
npm test
```
