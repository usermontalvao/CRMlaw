/**
 * Empacota `extension/` no .zip que o CRM oferece para download.
 *
 * A extensão não está na Chrome Web Store: ela se instala por "Carregar sem
 * compactação". Quem precisa dela hoje depende de alguém mandar a pasta por
 * fora — e pasta que circula por fora é pasta que fica velha. Servir o .zip
 * pelo próprio CRM faz o download acompanhar o deploy.
 *
 * Os arquivos vão para a RAIZ do zip, e não dentro de `extension/`: quem
 * descompacta aponta o Chrome para a pasta resultante, e o `manifest.json`
 * precisa estar lá em cima.
 *
 * Roda no `npm run build`, antes do Vite, e o .zip é gitignored — ele é
 * artefato, não fonte.
 */
import { createRequire } from 'node:module';
import { readdir, readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origem = path.join(raiz, 'extension');
const destino = path.join(raiz, 'public', 'downloads');
const nomeDoArquivo = 'jurius-authenticator.zip';

/** O que é da extensão e o que é do repositório. */
const FORA = new Set(['guardas.test.ts', '.DS_Store']);

async function juntar(zip, dir, prefixo = '') {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    if (FORA.has(item.name)) continue;
    const caminho = path.join(dir, item.name);
    const dentro = prefixo ? `${prefixo}/${item.name}` : item.name;
    if (item.isDirectory()) {
      await juntar(zip, caminho, dentro);
    } else {
      zip.file(dentro, await readFile(caminho));
    }
  }
}

async function main() {
  try {
    await stat(path.join(origem, 'manifest.json'));
  } catch {
    console.error('[extensão] extension/manifest.json não encontrado — nada a empacotar.');
    process.exit(1);
  }

  const manifest = JSON.parse(await readFile(path.join(origem, 'manifest.json'), 'utf8'));

  const zip = new JSZip();
  await juntar(zip, origem);

  const conteudo = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
    // Data fixa: sem isto o zip muda de bytes a cada build sem nada ter mudado.
    date: new Date('2020-01-01T00:00:00Z'),
  });

  await mkdir(destino, { recursive: true });
  await writeFile(path.join(destino, nomeDoArquivo), conteudo);

  const kb = (conteudo.byteLength / 1024).toFixed(0);
  console.log(`[extensão] ${nomeDoArquivo} — v${manifest.version}, ${kb} kB`);
}

main().catch((erro) => {
  console.error('[extensão] falhou ao empacotar:', erro);
  process.exit(1);
});
