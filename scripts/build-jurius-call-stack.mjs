#!/usr/bin/env node
// Gera a stack do Jurius Call para colar no Portainer.
//
// POR QUE ISTO EXISTE. O servidor não tem este repositório: ele constrói tudo a
// partir do que está na stack. Então o código-fonte do serviço Rust precisa
// viajar DENTRO do docker-compose. Cada arquivo vai comprimido e em base64 —
// gzip antes do base64 porque o texto de um fonte Rust encolhe ~4x, e uma stack
// de 20 KB é colável, uma de 60 KB não.
//
// FLUXO DE TRABALHO: edite os fontes em `server/jurius-call/src`, rode
//
//   node scripts/build-jurius-call-stack.mjs
//
// e cole o `server/jurius-call/deploy/docker-compose.yml` gerado no Portainer.
// Nunca edite o compose à mão: a próxima geração apagaria a alteração.
//
// DUAS ENTRADAS FICAM FORA DOS FONTES:
//   · `upstream.pin` — o commit EXATO do whatsapp-rust contra o qual o serviço
//     foi compilado. Vai versionado: é parte da receita de build, não segredo.
//   · `deploy/token.secret` — o JURIUS_CALL_TOKEN. NÃO vai versionado, e é por
//     causa dele que o compose gerado também está no .gitignore.
import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const origem = join(raiz, 'server', 'jurius-call');
const destino = join(origem, 'deploy', 'docker-compose.yml');
/** O plano B, para quando a rede do Docker está quebrada. Ver `montar`. */
const destinoHost = join(origem, 'deploy', 'docker-compose.host-network.yml');

/**
 * O commit do whatsapp-rust que este serviço consome.
 *
 * FIXO, e não `origin/main`. A biblioteca é a base do VoIP e recebe commits
 * todo dia; seguir o main faria cada `restart` do container recompilar contra
 * um código que ninguém verificou — e uma mudança de API lá derrubaria as
 * ligações aqui, num boot que ninguém pediu. Subir de versão passa a ser um ato
 * deliberado: troque o SHA em `upstream.pin`, recompile, teste, gere a stack.
 */
/**
 * Variante do DIAGNÓSTICO da oferta de vídeo (`--variante=B`). Ver o bloco
 * `JURIUS_OFFER_*` no compose gerado. Sem o argumento, a stack sai limpa: o
 * clone da biblioteca não é tocado e a oferta é a de sempre.
 */
const VARIANTES = {
  A: { node: '', cap: '' },
  B: { node: '0', cap: 'video' },
  C: { node: '1', cap: 'audio' },
  D: { node: '1', cap: 'video' },
};
const pedida = (process.argv.find(a => a.startsWith('--variante=')) || '').split('=')[1];
if (pedida && !VARIANTES[pedida]) {
  console.error(`--variante=${pedida} não existe. Use A, B, C ou D.`);
  process.exit(1);
}
const diag = !!pedida;
const variante = VARIANTES[pedida] ?? VARIANTES.A;

const pin = readFileSync(join(origem, 'upstream.pin'), 'utf8').trim();
if (!/^[0-9a-f]{40}$/.test(pin)) {
  console.error(`upstream.pin não é um SHA completo de 40 caracteres: ${pin}`);
  process.exit(1);
}

/**
 * O token da API. Sem arquivo, a stack sai com a API ABERTA — que é como o
 * WaCalls operava, mas hoje o endereço é público e sabe discar do número do
 * escritório. O aviso no fim da geração existe para isso não passar batido.
 */
const arquivoToken = join(origem, 'deploy', 'token.secret');
const token = existsSync(arquivoToken) ? readFileSync(arquivoToken, 'utf8').trim() : '';

/** Onde o serviço mora DENTRO do container. Fora de /opt/whatsapp-rust de
 *  propósito: aquele diretório é um clone que o boot reseta com `git reset
 *  --hard`, e o nosso código não pode depender de sobreviver a isso. */
const ALVO = '/opt/jurius-call';

/** Largura das linhas de base64 no compose. Ver o comentário na geração. */
const LARGURA_B64 = 800;

/** Os arquivos que compõem o serviço, em ordem estável. */
function fontes(dir = origem, acc = []) {
  for (const nome of readdirSync(dir).sort()) {
    if (nome === 'deploy' || nome === 'target') continue;
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) fontes(caminho, acc);
    else if (/\.(rs|toml)$/.test(nome)) acc.push(caminho);
  }
  return acc;
}

const arquivos = fontes();
if (!arquivos.length) {
  console.error('nenhum fonte encontrado em server/jurius-call');
  process.exit(1);
}

const linhas = [];
let bytesFonte = 0;
for (const caminho of arquivos) {
  const rel = relative(origem, caminho).split('\\').join('/');
  const bruto = readFileSync(caminho);
  bytesFonte += bruto.length;
  const b64 = gzipSync(bruto, { level: 9 }).toString('base64');
  linhas.push(`          mkdir -p ${ALVO}/${dirname(rel) === '.' ? '' : dirname(rel)}`.trimEnd());
  // Em pedaços, e não numa linha só: o fonte maior daria uma linha de quase
  // 10 000 caracteres, e editor de stack, proxy e log são todos lugares onde
  // uma linha assim é a primeira coisa a se suspeitar quando algo estoura.
  // Quebrar não muda um byte do resultado — `base64 -d` ignora as quebras.
  linhas.push('          {');
  for (let i = 0; i < b64.length; i += LARGURA_B64) {
    linhas.push(`          echo '${b64.slice(i, i + LARGURA_B64)}'`);
  }
  linhas.push(`          } | base64 -d | gzip -d > ${ALVO}/${rel}`);
}
const materializar = linhas.join('\n');

/**
 * A linha do token no bloco `environment`. Fechada, ela vira a variável de
 * verdade; sem token, fica um comentário dizendo o que falta — assim a stack
 * gerada nunca finge que está protegida.
 */
const linhaToken = token
  ? `      # Fecha a API: as rotas exigem "Authorization: Bearer <token>" e o /ws
      # exige ?token=. O CRM manda o mesmo valor via VITE_JURIUS_CALL_TOKEN.
      #
      # Isto barra a varredura anônima da internet, que é o risco real de um
      # endereço público que sabe discar do número do escritório. NÃO é segredo
      # de usuário: o valor vai no bundle do CRM, então qualquer pessoa com o
      # CRM aberto consegue lê-lo no devtools.
      JURIUS_CALL_TOKEN: "${token}"`
  : `      # SEM TOKEN: a API está ABERTA. Crie server/jurius-call/deploy/token.secret
      # e gere a stack de novo para fechá-la.
      # JURIUS_CALL_TOKEN: ""`;

/**
 * Duas stacks saem daqui:
 *
 *  · `bridge` — a normal. O container fica na rede do Docker e a porta do
 *    Cloudflare é publicada em 127.0.0.1:18473.
 *  · `host`   — o plano B para quando a rede do Docker está quebrada (o
 *    container não resolve nome nem alcança IP nenhum). Com o namespace de
 *    rede do host, DNS, rota e firewall passam a ser os do próprio servidor —
 *    os mesmos que o Portainer usa e que comprovadamente funcionam. O serviço
 *    então escuta DIRETO em 127.0.0.1:18473, que é o endereço para onde o
 *    Cloudflare já aponta, e por ser loopback ele continua invisível de fora.
 */
function montar(modo) {
const hostNet = modo === 'host';
const blocoRede = hostNet
  ? `    # Rede do HOST, sem bridge do Docker. Escolhido porque o container não
    # resolvia nomes nem alcançava a internet pela rede do Docker; aqui ele
    # herda o DNS e as rotas do servidor. Em troca, "ports" não existe: quem
    # define o endereço é o JURIUS_CALL_BIND abaixo.
    network_mode: "host"`
  : `    # A porta que o Cloudflare já publica em call.jurius-api.com. O serviço
    # escuta em 3000 dentro do container; HTTP e WebSocket saem pela MESMA
    # porta, que é o ponto do desenho — não há segundo endereço a abrir.
    ports:
      - "127.0.0.1:18473:3000"

    # DNS explícito, para o caso de o container herdar um resolv.conf quebrado
    # do host. Sem DNS nada funciona: nem apt, nem o git do GitHub, nem o
    # download dos crates.
    dns:
      - 1.1.1.1
      - 8.8.8.8`;
// Com a rede do host, o serviço PRECISA se prender ao loopback: 0.0.0.0 ali
// exporia a API na internet, porque não há mais mapeamento de porta filtrando.
const bind = hostNet ? '127.0.0.1:18473' : '0.0.0.0:3000';

/**
 * Conferência de porta ocupada — só no modo host.
 *
 * Na bridge, quem falha é o próprio Docker ao criar o container, antes de este
 * script existir. Com a rede do host o bind acontece no fim, DEPOIS de compilar:
 * sem esta checagem, um `call_gateway` esquecido na 18473 faz o serviço morrer
 * no último passo e o restart automático recompila tudo de novo, em laço.
 */
const blocoPorta = hostNet
  ? `
          if (echo > /dev/tcp/127.0.0.1/18473) >/dev/null 2>&1; then
            echo "=========================================="
            echo " ERRO: porta 127.0.0.1:18473 ja esta em uso"
            echo "=========================================="
            if command -v ss >/dev/null 2>&1; then
              echo "Listeners encontrados:"
              ss -ltnp 2>/dev/null | grep ':18473 ' || true
            fi
            echo ""
            echo "Pare/remova o container antigo call_gateway ou qualquer processo"
            echo "que esteja usando a 18473 e depois atualize esta stack."
            echo "=========================================="
            sleep 60
            exit 1
          fi
`
  : '';

return `# ============================================================================
#  Jurius Call — voz e vídeo do WhatsApp para dentro do navegador.
#
#  GERADO POR scripts/build-jurius-call-stack.mjs. NÃO EDITE À MÃO.
#  Fonte: server/jurius-call/ no repositório do CRM.
#
#  O que mudou em relação à stack anterior:
#    · o container passa a rodar o SERVIÇO (API + WebSocket) em vez do
#      voip-cli em modo \`listen\` (que recusava toda chamada automaticamente);
#    · a porta 18473 do Cloudflare aponta direto para ele — o call_gateway
#      (página estática em Node) saiu, porque o próprio serviço responde
#      \`/healthz\` e serve a página de status;
#    · a sessão pareada continua onde está: volume whatsapp_rust_data em
#      /data/whatsapp.db. NADA aqui apaga ou recria esse volume.
#
#  ATENÇÃO: só UM processo pode manter a sessão do WhatsApp de pé. Esta stack
#  substitui o voip-cli; rodar os dois juntos faz os dois brigarem pelo socket
#  e nenhum fica conectado.
# ============================================================================
services:
  whatsapp-rust:
    image: rust:bookworm
    container_name: whatsapp_rust
    restart: unless-stopped
    working_dir: ${ALVO}

${blocoRede}

    environment:
      TZ: "America/Cuiaba"
      RUST_LOG: "info,webrtc_sctp=error,webrtc_dtls=error"
      CARGO_HOME: "/usr/local/cargo"
      RUSTUP_HOME: "/usr/local/rustup"
      PATH: "/usr/local/cargo/bin:/usr/local/rustup/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      # Compartilha os artefatos já compilados do clone: a primeira build do
      # serviço reaproveita quase todo o fecho de dependências do voip-cli.
      CARGO_TARGET_DIR: "/opt/whatsapp-rust/target"
      JURIUS_CALL_DB: "/data/whatsapp.db"
      JURIUS_CALL_BIND: "${bind}"
      # ---------------------------------------------------------------- DIAGNÓSTICO
      # A matriz que separa as DUAS variáveis que sobraram na oferta de vídeo
      # que não faz o telefone tocar: o nó <video> e o byte da capability.
      #
      #   A  node=""  cap=""       oferta normal (voz toca; vídeo não toca)
      #   B  node="0" cap="video"  sem <video>, capability de vídeo (…fa13)
      #   C  node="1" cap="audio"  com <video>, capability de áudio (…bb13)
      #
      # Trocar aqui no editor da stack e dar update é o jeito de andar na matriz —
      # é a ÚNICA parte deste arquivo que se edita à mão, e ela some quando a
      # stack for regerada sem o diagnóstico. Com DIAG diferente de "1" o clone
      # da biblioteca não é tocado.
      JURIUS_OFFER_DIAG: "${diag ? '1' : ''}"
      JURIUS_OFFER_VIDEO_NODE: "${variante.node}"
      JURIUS_OFFER_CAP: "${variante.cap}"
${linhaToken}

    volumes:
      - whatsapp_rust_app:/opt/whatsapp-rust
      - whatsapp_rust_data:/data
      - whatsapp_rust_cargo_registry:/usr/local/cargo/registry
      - whatsapp_rust_cargo_git:/usr/local/cargo/git

    stdin_open: true
    tty: true

    command:
      - /bin/bash
      - -c
      - |
          set -e

          export CARGO_HOME=/usr/local/cargo
          export RUSTUP_HOME=/usr/local/rustup
          export PATH="/usr/local/cargo/bin:/usr/local/rustup/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

          echo "=========================================="
          echo " Jurius Call - voz e video"
          echo "=========================================="

          # Rede primeiro: sem ela o git e o cargo morrem la' na frente com um
          # erro que nao parece de rede. E quando falha, o log tem de dizer QUAL
          # camada caiu — "sem DNS" sozinho nao distingue resolver quebrado de
          # container sem rota nenhuma, e sao consertos diferentes.
          if getent hosts github.com >/dev/null 2>&1; then
            echo "Rede: ok"
          else
            echo "=========================================="
            echo " ERRO DE REDE — diagnostico"
            echo "=========================================="
            echo "[1] /etc/resolv.conf (mostra se o dns: da stack pegou):"
            cat /etc/resolv.conf 2>&1 | sed 's/^/    /'
            echo "[2] rota ate' a internet, SEM usar DNS (IP cru):"
            curl -s -m 8 -o /dev/null -w "    https://1.1.1.1 respondeu %{http_code} em %{time_total}s\\n" https://1.1.1.1/ \\
              || echo "    SEM ROTA: o container nao alcanca 1.1.1.1."
            echo "[3] resolucao por DoH (rota ok + resolucao externa):"
            curl -s -m 8 -H 'accept: application/dns-json' \\
              'https://1.1.1.1/dns-query?name=github.com&type=A' 2>&1 | head -c 300 | sed 's/^/    /'
            echo ""
            echo "[4] resolver do sistema:"
            getent hosts github.com 2>&1 | sed 's/^/    /' || echo "    falhou"
            echo "=========================================="
            echo " Como ler: [2] falhando = o container nao tem rota, e nenhum"
            echo " ajuste de DNS conserta — use a stack docker-compose.host-network.yml."
            echo " [2] ok e [4] falhando = so' o resolver; confira o [1]."
            echo "=========================================="
            # Pausa antes de morrer: com restart automatico, sair na hora
            # enche o log de repeticoes e esconde a linha que interessa.
            sleep 30
            exit 1
          fi

${blocoPorta}
          # A imagem rust:bookworm ja' traz git, curl, ca-certificates, gcc,
          # pkg-config e libssl-dev. O apt aqui existe para UMA coisa: cmake e
          # clang, que so' o libopus precisa. Por isso ele NAO e' fatal — sem
          # esses dois o servico compila igual, apenas sem o decodificador Opus
          # de reserva.
          export DEBIAN_FRONTEND=noninteractive
          apt-get -qq update -o Dpkg::Use-Pty=0 || echo "AVISO: apt-get update falhou."
          apt-get -qq install -y --no-install-recommends -o Dpkg::Use-Pty=0 \\
            cmake clang iproute2 procps || echo "AVISO: dependencias auxiliares nao instaladas."

          # A biblioteca. O clone é o mesmo de sempre; o serviço a consome como
          # dependencia de caminho, sem alterar um arquivo dela.
          if [ ! -d /opt/whatsapp-rust/.git ]; then
            echo "Clonando whatsapp-rust..."
            rm -rf /opt/whatsapp-rust/*
            rm -rf /opt/whatsapp-rust/.[!.]* 2>/dev/null || true
            git clone --depth 1 https://github.com/oxidezap/whatsapp-rust.git /opt/whatsapp-rust
          fi

          cd /opt/whatsapp-rust
          # COMMIT FIXO, nao origin/main. Um restart nao pode trazer codigo novo
          # da biblioteca sem ninguem ter olhado: e' o motor das ligacoes.
          echo "Fixando a biblioteca em ${pin}..."
          # Ja' estando no commit certo, nao toca na rede: um redeploy com o
          # GitHub fora do ar (ou o DNS oscilando) ainda sobe.
          git rev-parse HEAD | grep -q '^${pin}' || {
            # Busca o commit pelo SHA (o GitHub permite). O clone e' raso, entao
            # um pin ANTIGO nao estaria nele: os fallbacks abrem o historico.
            git fetch --depth 1 origin ${pin} || git fetch --unshallow || git fetch origin
            git checkout -f ${pin}
            git reset --hard ${pin}
          }

          # A conferencia e' o que torna o pin uma garantia, e nao um desejo.
          git rev-parse HEAD | grep -q '^${pin}' || {
            echo "ERRO: a biblioteca nao ficou no commit ${pin}."
            exit 1
          }

          # ------------------------------------------------------ DIAGNOSTICO
          # A matriz A/B/C/D da oferta de video. As duas linhas trocadas fazem a
          # biblioteca ler ENV em vez de deduzir do VideoSource — e com as
          # variaveis vazias o comportamento e' EXATAMENTE o de sempre
          # (unwrap_or(video.is_some())).
          #
          # Isto e' a UNICA coisa em todo o projeto que altera o upstream, existe
          # para responder uma pergunta e sai daqui depois. Por isso a conferencia
          # logo abaixo: um sed que nao casa nao pode passar batido, senao a
          # gente testaria a variante achando que testou outra.
          # A base tem de ser SEMPRE o arquivo original: o git reset acima so'
          # roda quando o HEAD nao esta' no pin, entao um patch de um boot
          # anterior sobreviveria calado ao redeploy seguinte.
          git -C /opt/whatsapp-rust checkout -- src/voip/facade.rs 2>/dev/null || true
          if [ "$\${JURIUS_OFFER_DIAG}" = "1" ]; then
            echo "DIAGNOSTICO: variante de oferta node='$\${JURIUS_OFFER_VIDEO_NODE}' cap='$\${JURIUS_OFFER_CAP}'"
            # Caminho LITERAL e cifrao dobrado no $$(...): o docker-compose
            # interpola tudo o que parece variavel antes de o bash ver, e foi
            # assim que a primeira versao chegou com o caminho vazio
            # ("sed: can't read :"). Mesma armadilha ja' anotada no bloco da porta.
            # Pelo mesmo motivo o segundo padrao nao usa o ancora de fim de linha:
            # um cifrao solto no meio do compose e' interpolacao invalida. O ancora
            # de inicio com os 8 espacos ja' e' unico (a outra ocorrencia, na
            # oferta de grupo, tem 12).
            sed -i 's#capability: Some(offer_capability(video.is_some(), audio.config().format)),#capability: Some(offer_capability(std::env::var("JURIUS_OFFER_CAP").map(|v| v == "video").unwrap_or(video.is_some()), audio.config().format)),#' /opt/whatsapp-rust/src/voip/facade.rs
            sed -i 's#^        video: video.is_some(),#        video: std::env::var("JURIUS_OFFER_VIDEO_NODE").map(|v| v == "1").unwrap_or(video.is_some()),#' /opt/whatsapp-rust/src/voip/facade.rs
            if [ "$$(grep -c JURIUS_OFFER_CAP /opt/whatsapp-rust/src/voip/facade.rs)" != "1" ] || [ "$$(grep -c JURIUS_OFFER_VIDEO_NODE /opt/whatsapp-rust/src/voip/facade.rs)" != "1" ]; then
              echo "ERRO: o patch de diagnostico nao casou com o facade.rs deste commit."
              echo "      Sem ele a variante testada nao seria a pedida. Abortando."
              sleep 30
              exit 1
            fi
            echo "DIAGNOSTICO: patch aplicado."
          fi

          # O serviço do Jurius, escrito por cima. Materializado a cada boot a
          # partir desta stack: o que esta colado aqui e' a verdade, e nao ha
          # estado antigo escondido num volume.
          echo "Escrevendo o servico Jurius Call..."
          rm -rf ${ALVO}
${materializar}

          cd ${ALVO}
          echo "Compilando (a primeira vez demora; as seguintes usam o cache)..."
          # O decodificador Opus de reserva puxa o libopus, que precisa de cmake
          # e clang. Sem eles, compilar assim mesmo e' melhor do que nao subir:
          # a perda e' um tipo de quadro que o outro lado raramente manda.
          if command -v cmake >/dev/null 2>&1 && command -v clang >/dev/null 2>&1; then
            /usr/local/cargo/bin/cargo build --release
          else
            echo "AVISO: sem cmake/clang — compilando SEM o Opus de reserva."
            /usr/local/cargo/bin/cargo build --release --no-default-features
          fi

          # Caminho literal, sem variavel de shell: o docker-compose interpola
          # as variaveis dentro do bloco antes de o bash ver, e ela chegaria
          # vazia.
          if [ ! -x /opt/whatsapp-rust/target/release/jurius-call ]; then
            echo "ERRO: o binario nao foi criado."
            exit 1
          fi

          echo "=========================================="
          echo " Jurius Call pronto"
          echo " Sessao: /data/whatsapp.db (preservada)"
          echo " HTTP + WebSocket: ${bind}"
          # O cifrao dobrado e' o escape do docker-compose: o bash recebe a
          # variavel e imprime o endereco que o servico REALMENTE vai usar, e
          # nao o que este gerador achou que ele usaria.
          echo " Bind efetivo: $\${JURIUS_CALL_BIND}"
          echo "=========================================="

          exec /opt/whatsapp-rust/target/release/jurius-call

volumes:
  whatsapp_rust_app:
    name: whatsapp_rust_app

  whatsapp_rust_data:
    name: whatsapp_rust_data

  whatsapp_rust_cargo_registry:
    name: whatsapp_rust_cargo_registry

  whatsapp_rust_cargo_git:
    name: whatsapp_rust_cargo_git
`;

}

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
for (const [modo, caminho] of [['bridge', destino], ['host', destinoHost]]) {
  const conteudo = montar(modo);
  writeFileSync(caminho, conteudo);
  console.log(`stack (${modo}): ${relative(raiz, caminho)} — ${kb(conteudo.length)}`);
}
console.log(`  ${arquivos.length} arquivos de fonte, ${kb(bytesFonte)}`);
console.log(token ? '  API fechada por token.' : '  ATENÇÃO: sem token, a API sobe ABERTA.');
console.log(diag
  ? `  DIAGNÓSTICO ligado: variante ${pedida} (video_node='${variante.node}' cap='${variante.cap}') — o upstream é patcheado no boot.`
  : '  Sem diagnóstico: o upstream não é tocado.');
