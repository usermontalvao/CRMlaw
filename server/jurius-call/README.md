# Jurius Call

Voz **e vídeo** do WhatsApp para dentro do navegador do escritório, sobre a
biblioteca [`whatsapp-rust`](https://github.com/oxidezap/whatsapp-rust).

Substitui o WaCalls. Nada aqui altera a biblioteca: ela entra como dependência
de caminho para o clone que o container já mantém em `/opt/whatsapp-rust`, **fixo
no commit de `upstream.pin`** — nunca em `origin/main`.

## O desenho, e por que ele é assim

```
navegador Jurius
      │  HTTPS + WebSocket   (call.jurius-api.com → 127.0.0.1:18473)
      ▼
Jurius Call (este serviço, Rust)
      │
      ▼
whatsapp-rust VoIP  ──►  relays da Meta  ──►  cliente WhatsApp
```

**Não há WebRTC entre o navegador e o Docker.** Era exatamente aí que o WaCalls
quebrava: o container anunciava `172.24.0.2` (o IP da rede interna do Docker)
como candidato ICE, o ICE do navegador ficava eternamente em `checking`, e a
ligação existia — o WhatsApp atendia, o cronômetro corria — sem áudio em
direção nenhuma. Um WebSocket sobre a URL que o Cloudflare já publica não tem
endereço a descobrir.

A perna `servidor ↔ Meta` continua sendo do `whatsapp-rust` (DTLS/SCTP sobre os
relays), e essa sempre foi a perna saudável.

## Mídia

| | formato na fronteira | quem codifica |
|---|---|---|
| Áudio | PCM 16 kHz mono, Int16 LE, **exatamente 960 amostras** (60 ms) | ninguém — o motor faz MLOW |
| Vídeo | H.264 **Annex-B**, uma unidade de acesso completa por quadro | o navegador (WebCodecs) |

O tamanho do quadro de áudio não é sugestão: o motor **descarta** qualquer
outro tamanho, sem erro e sem som. Por isso o worklet de captura do CRM acumula
até fechar 960 amostras em vez de mandar os blocos de 128 que a placa entrega.

O vídeo é responsabilidade do consumidor por decisão da biblioteca — o
`voip/video.rs` transporta H.264 pré-codificado e nunca toca em pixel. O CRM usa
`VideoEncoder`/`VideoDecoder` com `avc: { format: 'annexb' }`, que é o formato
do fio: sem isso o Chrome entrega AVCC e o outro lado não decodifica nada.
Codificar no navegador (e não aqui) evita transcodificar o vídeo de todos os
atendentes num contêiner que não tem CPU sobrando.

## API

Tudo em `call.jurius-api.com`.

```
GET  /healthz
GET  /api/status
GET  /api/calls
POST /api/calls                         {"to":"5565…","video":false}
POST /api/calls/{id}/accept             {"video":false}
POST /api/calls/{id}/reject
POST /api/calls/{id}/hangup
POST /api/calls/{id}/mute               {"muted":true}
POST /api/calls/{id}/video/enable       {"fps":15}
POST /api/calls/{id}/video/disable
WSS  /ws?clientId=…[&token=…]
```

`X-Client-Id` identifica a aba: é o **dono** da chamada, e é por ele que o
servidor recusa uma segunda chamada do mesmo operador (409) e que as outras
abas sabem que o convite já foi atendido.

### Token

Com `JURIUS_CALL_TOKEN` definido, todas as rotas exigem
`Authorization: Bearer <token>` e o `/ws` exige `?token=`. Sem a variável, a API
fica aberta — que é como o WaCalls operava.

O valor vive em `deploy/token.secret` (fora do git; é ele que faz o compose
gerado também ficar fora do git) e o CRM manda o mesmo em
`VITE_JURIUS_CALL_TOKEN`.

**O que este token protege, e o que não protege.** Ele barra a varredura anônima
da internet — que é o risco concreto de um endereço público capaz de discar do
número do escritório. Ele **não** é segredo de usuário: vai no bundle do CRM, e
quem tem o CRM aberto o lê no devtools. No WebSocket ele viaja na query string
porque o navegador não permite cabeçalho no handshake; como o valor já é público
para quem usa o CRM, aparecer num log de proxy não muda a exposição.

## O WebSocket

Um socket por aba, carregando duas coisas:

* **texto** — sinalização em JSON (`hello`, `status`, `incoming_call`,
  `outgoing_call`, `call_accepted`, `call_active`, `call_update`, `call_ended`,
  `video_state`, `missed_call`, `call_elsewhere`, `error`);
* **binário** — mídia, nunca JSON/base64 (custaria 33% a mais de banda e uma
  volta de parser a cada 60 ms).

Cabeçalho de todo quadro binário, 4 bytes:

```
[0] kind         1 = áudio PCM, 2 = unidade de vídeo H.264
[1] flags        bit 0 = keyframe
[2] orientation  0..3, giro de 90° da câmera do outro lado
[3] reservado
```

São 4 bytes e não 1 ou 3 porque o áudio precisa começar num deslocamento par —
`new Int16Array(buffer, 4)` funciona, `new Int16Array(buffer, 1)` lança.

O navegador manda `{"type":"attach","callId":"…"}` para passar a receber (e
poder mandar) a mídia de uma chamada. **Só quem está acoplado recebe áudio e
vídeo**: a voz de uma ligação não vaza para a aba que não a atende.

## A versão da biblioteca

`upstream.pin` guarda o commit exato do `whatsapp-rust` contra o qual este
serviço foi compilado e testado. A stack faz `checkout` desse SHA e **confere o
`rev-parse` depois** — se não bater, o boot falha em vez de rodar contra outro
código.

Seguir `origin/main` seria pior do que parece: a biblioteca recebe commits todo
dia e é o motor das ligações. Um `restart` do container recompilaria contra
código que ninguém olhou, e uma mudança de API lá derrubaria o telefone daqui
num boot que ninguém pediu.

Subir de versão é um ato deliberado:

1. troque o SHA em `upstream.pin`;
2. compile e teste (ver *Compilar fora do container*);
3. gere a stack e faça o deploy.

## Sessão

A conta pareada vive em `/data/whatsapp.db` — o mesmo arquivo que o voip-cli
usava, o mesmo volume `whatsapp_rust_data`. Nada neste serviço apaga ou recria
esse volume.

**Só um processo pode manter a sessão de pé.** Esta stack substitui o voip-cli;
os dois juntos brigam pelo socket e nenhum fica conectado. Se um QR code
aparecer no log, o pareamento se perdeu — o serviço grita isso em `warn`.

## Deploy

O servidor não tem este repositório: ele constrói tudo a partir da stack. Por
isso os fontes viajam dentro do `docker-compose.yml`, comprimidos e em base64.

```bash
node scripts/build-jurius-call-stack.mjs
```

Isso regenera **duas** stacks em `server/jurius-call/deploy/`. Cole o conteúdo da
que servir no Portainer (stack do `whatsapp_rust`) e mande atualizar. **Nunca
edite o compose à mão** — a próxima geração apagaria a alteração.

| arquivo | quando usar |
|---|---|
| `docker-compose.yml` | o normal: rede do Docker, porta publicada em `127.0.0.1:18473` |
| `docker-compose.host-network.yml` | quando o container não alcança a internet pela rede do Docker |

O plano B usa `network_mode: host`: o container passa a herdar DNS, rotas e
firewall do próprio servidor — os mesmos que o Portainer usa e que
comprovadamente funcionam. Em troca, `ports` deixa de existir, e por isso o
serviço se prende direto a `127.0.0.1:18473` (o endereço para onde o Cloudflare
já aponta). O bind é loopback de propósito: com a rede do host, `0.0.0.0` exporia
a API na internet, porque não há mais mapeamento de porta filtrando.

Se o boot falhar por rede, o log traz um diagnóstico de quatro linhas que separa
"resolver quebrado" de "container sem rota" — são consertos diferentes.

A primeira compilação demora (o fecho de dependências inclui `webrtc-dtls`,
`webrtc-sctp` e o `libopus`); as seguintes reaproveitam
`CARGO_TARGET_DIR=/opt/whatsapp-rust/target`, que é o mesmo cache que o voip-cli
já tinha preenchido.

### Conferir se subiu

```bash
curl -s https://call.jurius-api.com/api/status
```

`"connected": true` com um `jid` preenchido significa sessão carregada e
conta no ar.

## Compilar fora do container

O `Cargo.toml` aponta para `/opt/whatsapp-rust`. Para compilar em outro lugar,
troque os dois `path` para o seu clone. A feature `opus-fallback` (ligada por
padrão) puxa o `libopus` e exige `cmake`; sem ele, compile com
`--no-default-features` — o serviço funciona, apenas descarta o pacote Opus que
o outro lado às vezes embute no perfil MLOW.
