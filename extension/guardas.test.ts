// Guardas da extensão — as promessas que o manifest e o código fazem, viradas
// em teste. Não é decoração: cada uma destas linhas já foi uma vulnerabilidade
// em alguma extensão de autenticador.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(RAIZ, 'manifest.json'), 'utf8'));

function arquivos(dir: string, filtro: (nome: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const caminho = join(dir, entrada.name);
    if (entrada.isDirectory()) return arquivos(caminho, filtro);
    return filtro(entrada.name) ? [caminho] : [];
  });
}

/** Remove comentário e string para o teste não acusar a própria explicação. */
function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

test('manifest é V3 e pede o mínimo', () => {
  assert.equal(manifest.manifest_version, 3);

  // `activeTab` + `scripting` entraram para o "Preencher" escrever o código no
  // campo da página. É uma ampliação DELIBERADA, e a mais estreita possível:
  // `activeTab` vale para UMA aba, concedida pelo clique no botão, e caduca
  // quando a aba navega. O que NÃO entrou é o que importa — ver abaixo.
  assert.deepEqual([...manifest.permissions].sort(), ['activeTab', 'alarms', 'scripting', 'storage']);

  for (const proibida of ['tabs', 'webRequest', 'webNavigation', 'clipboardRead', 'cookies', 'history', 'downloads', 'management', 'debugger', 'nativeMessaging', 'declarativeNetRequest']) {
    assert.ok(!manifest.permissions.includes(proibida), `permissão desnecessária: ${proibida}`);
  }

  // O par que transformaria `activeTab` em acesso irrestrito.
  assert.ok(!manifest.content_scripts, 'a extensão não injeta script sozinha em página nenhuma');
  assert.ok(
    !(manifest.host_permissions ?? []).some((h: string) => !h.includes('/functions/v1/totp-vault/')),
    'host_permissions só pode conter o cofre — com site aqui, activeTab deixaria de ser "só quando clicam"',
  );
  // O CRM precisa de UM marcador para saber se a extensão existe neste
  // navegador. É só o ícone pequeno, restrito às origens do próprio produto;
  // nenhum script, HTML, token ou arquivo de dados fica público.
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ['icons/icon-16.png'],
    matches: [
      'https://jurius.com.br/*',
      'https://www.jurius.com.br/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],
  }]);
  assert.ok(!manifest.externally_connectable, 'nenhum site conversa com a extensão');
});

test('o preenchimento escreve, e só: não lê a página nem manda nada de volta', () => {
  const fonte = semComentarios(readFileSync(join(RAIZ, 'src/lib/preencher.js'), 'utf8'));

  assert.ok(!/\bfetch\s*\(/.test(fonte), 'a função injetada não fala com a rede');
  assert.ok(!/XMLHttpRequest|sendBeacon|WebSocket/.test(fonte));
  assert.ok(!/\.submit\s*\(/.test(fonte), 'quem confirma o formulário é a pessoa, não a extensão');
  assert.ok(!/document\.cookie/.test(fonte), 'não toca em cookie');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(fonte));

  // O retorno é um veredito, não conteúdo da página.
  assert.match(fonte, /return \{ ok: (?:true|false)/);
  assert.ok(!/\.innerText|\.textContent\s*\}/.test(fonte), 'não devolve texto lido da página');
});

test('o código preenchido é buscado na hora, não vem do popup', () => {
  const sw = semComentarios(readFileSync(join(RAIZ, 'src/background/service-worker.js'), 'utf8'));
  const preencher = sw.slice(sw.indexOf('async preencher('));
  const corpo = preencher.slice(0, preencher.indexOf('\n  },'));

  assert.match(corpo, /api\('\/codes'/, 'o código vem do cofre no momento do clique');
  assert.ok(!/args:\s*\[\s*dados/.test(corpo), 'o popup não escolhe o que é injetado');
  assert.match(corpo, /executeScript/);
});

test('só o endereço do cofre é alcançável', () => {
  assert.equal(manifest.host_permissions.length, 1);
  const host = manifest.host_permissions[0];
  assert.ok(host.startsWith('https://'), 'nada por HTTP simples');
  assert.ok(host.includes('/functions/v1/totp-vault/'), 'o acesso é ao cofre, não ao projeto inteiro');
  assert.ok(!/<all_urls>|\*:\/\/\*/.test(host), 'nada de curinga de host');
});

test('a CSP não deixa entrar código remoto nem eval', () => {
  const csp = manifest.content_security_policy.extension_pages as string;
  assert.match(csp, /script-src 'self'/);
  assert.ok(!csp.includes('unsafe-eval'), 'unsafe-eval é proibido');
  assert.ok(!csp.includes('unsafe-inline'), 'inline script é proibido');
  assert.ok(!/script-src[^;]*https?:/.test(csp), 'nenhuma origem remota em script-src');
  assert.match(csp, /connect-src[^;]*supabase\.co/);
  assert.ok(!/connect-src[^;]*\*/.test(csp), 'connect-src não pode ser curinga');
});

test('nenhum arquivo empacotado usa eval, Function ou carrega script remoto', () => {
  const alvos = arquivos(RAIZ, (nome) => nome.endsWith('.js'));
  assert.ok(alvos.length >= 5, 'o teste tem de estar vendo os arquivos');

  for (const arquivo of alvos) {
    const fonte = semComentarios(readFileSync(arquivo, 'utf8'));
    assert.ok(!/\beval\s*\(/.test(fonte), `eval em ${arquivo}`);
    assert.ok(!/new\s+Function\s*\(/.test(fonte), `new Function em ${arquivo}`);
    assert.ok(!/importScripts\s*\(/.test(fonte), `importScripts em ${arquivo}`);
    assert.ok(!/from\s+['"]https?:/.test(fonte), `import remoto em ${arquivo}`);
    assert.ok(!/<script[^>]+src=["']https?:/.test(fonte), `script remoto em ${arquivo}`);
  }
});

test('nenhum HTML carrega script ou estilo de fora', () => {
  for (const arquivo of arquivos(RAIZ, (nome) => nome.endsWith('.html'))) {
    const fonte = readFileSync(arquivo, 'utf8');
    assert.ok(!/(src|href)=["']https?:/.test(fonte), `recurso remoto em ${arquivo}`);
  }
});

test('segredo não vai para localStorage nem para o storage sincronizado', () => {
  for (const arquivo of arquivos(RAIZ, (nome) => nome.endsWith('.js'))) {
    const fonte = semComentarios(readFileSync(arquivo, 'utf8'));
    assert.ok(!/\blocalStorage\b/.test(fonte), `localStorage em ${arquivo}`);
    assert.ok(!/\bsessionStorage\b/.test(fonte), `sessionStorage em ${arquivo}`);
    assert.ok(!/storage\.sync\b/.test(fonte), `chrome.storage.sync em ${arquivo}`);
  }
});

test('o popup não fala com a rede: quem faz isso é o service worker', () => {
  const popup = semComentarios(readFileSync(join(RAIZ, 'src/popup/popup.js'), 'utf8'));
  assert.ok(!/\bfetch\s*\(/.test(popup), 'o popup não deve chamar fetch');
  assert.ok(!/XMLHttpRequest/.test(popup), 'o popup não deve usar XHR');
  assert.ok(!/X-Vault-Session/.test(popup), 'o token não passa pelo popup');
});

test('o popup escreve conteúdo do servidor como texto, nunca como HTML', () => {
  const popup = semComentarios(readFileSync(join(RAIZ, 'src/popup/popup.js'), 'utf8'));
  assert.ok(!/\.innerHTML\s*=/.test(popup), 'innerHTML abre porta para XSS de nome de chave');
  assert.ok(!/\.outerHTML\s*=/.test(popup));
  assert.ok(!/insertAdjacentHTML/.test(popup));
  assert.ok(!/document\.write/.test(popup));
});

test('todo arquivo citado pelo manifest e pelos HTML existe', () => {
  const citados = [
    manifest.background.service_worker,
    manifest.options_page,
    manifest.action.default_popup,
    ...Object.values(manifest.icons) as string[],
    ...Object.values(manifest.action.default_icon) as string[],
  ];
  for (const referencia of citados) {
    assert.ok(existsSync(join(RAIZ, referencia)), `manifest cita ${referencia}, que não existe`);
  }

  for (const arquivo of arquivos(RAIZ, (nome) => nome.endsWith('.html'))) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const achado of fonte.matchAll(/(?:src|href)="([^"]+)"/g)) {
      assert.ok(existsSync(resolve(dirname(arquivo), achado[1])), `${arquivo} cita ${achado[1]}, que não existe`);
    }
  }

  for (const arquivo of arquivos(RAIZ, (nome) => nome.endsWith('.js'))) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const achado of fonte.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      assert.ok(existsSync(resolve(dirname(arquivo), achado[1])), `${arquivo} importa ${achado[1]}, que não existe`);
    }
  }
});

test('o ID da extensão é fixo — a origem no cofre depende disso', () => {
  assert.equal(typeof manifest.key, 'string');
  assert.ok(manifest.key.length > 300, 'a chave pública tem de estar completa no manifest');
});

// ── a câmera ────────────────────────────────────────────────────────────────

test('a janela da câmera não fala com a rede nem toca no token', () => {
  const scan = semComentarios(readFileSync(join(RAIZ, 'src/scan/scan.js'), 'utf8'));
  assert.ok(!/\bfetch\s*\(/.test(scan), 'quem fala com o cofre é o service worker');
  assert.ok(!/XMLHttpRequest/.test(scan));
  assert.ok(!/X-Vault-Session/.test(scan), 'o token não passa pela tela da câmera');
  assert.ok(!/\.innerHTML\s*=/.test(scan), 'innerHTML com conteúdo de QR seria XSS');
});

test('a câmera é desligada de verdade — a luz do equipamento tem de apagar', () => {
  const scan = semComentarios(readFileSync(join(RAIZ, 'src/scan/scan.js'), 'utf8'));
  assert.match(scan, /getTracks\(\)[\s\S]{0,40}\.stop\(\)/, 'as trilhas precisam ser paradas');
  assert.match(scan, /pagehide|visibilitychange/, 'fechar ou esconder a janela tem de desligar a câmera');
});

test('nenhum quadro da câmera é gravado ou enviado', () => {
  const scan = semComentarios(readFileSync(join(RAIZ, 'src/scan/scan.js'), 'utf8'));
  for (const proibido of ['MediaRecorder', 'toDataURL', 'toBlob', 'captureStream', 'showSaveFilePicker']) {
    assert.ok(!scan.includes(proibido), `${proibido} guardaria imagem da câmera`);
  }
});

test('a CSP permite o vídeo local sem abrir origem remota', () => {
  const csp = manifest.content_security_policy.extension_pages as string;
  assert.match(csp, /media-src[^;]*'self'/);
  assert.ok(!/media-src[^;]*\*/.test(csp), 'media-src não pode ser curinga');
  assert.ok(!/media-src[^;]*https?:/.test(csp), 'nenhuma origem remota em media-src');
});

test('a câmera não custou permissão nova no manifest', () => {
  // getUserMedia numa página de extensão usa o modelo de permissão da web: o
  // usuário concede na hora. A lista completa é fixada no teste do manifest;
  // aqui o que se vigia é que ninguém tomou o atalho de pedir a câmera (ou a
  // aba inteira) no manifest para poupar o pedido em tempo de uso.
  for (const atalho of ['camera', 'videoCapture', 'audioCapture', 'tabCapture', 'desktopCapture']) {
    assert.ok(!manifest.permissions.includes(atalho), `permissão de captura indevida: ${atalho}`);
  }
});

test('nenhum HTML usa estilo inline — a CSP recusa, e recusar é o certo', () => {
  // `style-src 'self'` bloqueia tanto `<style>` quanto o atributo `style=`.
  // Isto já quebrou a tela de login em produção: o rodapé com `style=` foi
  // recusado pelo navegador e o layout saiu torto. É a mesma porta por onde
  // entraria estilo injetado, então a regra fica — e o teste vigia.
  for (const arquivo of arquivos(RAIZ, (nome) => nome.endsWith('.html'))) {
    const fonte = readFileSync(arquivo, 'utf8');
    assert.ok(!/\sstyle\s*=\s*["']/.test(fonte), `atributo style= em ${arquivo}`);
    assert.ok(!/<style[\s>]/i.test(fonte), `bloco <style> em ${arquivo}`);
  }
});

test('a folha de estilo citada por cada HTML existe', () => {
  for (const arquivo of arquivos(RAIZ, (nome) => nome.endsWith('.html'))) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const achado of fonte.matchAll(/<link[^>]+href="([^"]+\.css)"/g)) {
      assert.ok(existsSync(resolve(dirname(arquivo), achado[1])), `${arquivo} cita ${achado[1]}, que não existe`);
    }
  }
});
