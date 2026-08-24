// Ícones da extensão Authenticator.
//
// Rode com: node scripts/render-authenticator-icons.mjs
//
// A fonte é `public/logo.png` — a LOGO OFICIAL do escritório, a mesma do CRM.
// A extensão não tem identidade própria: ela é o Jurius num outro lugar.
//
// Já houve aqui um escudo desenhado à mão e, depois, uma chave: os dois eram
// símbolo genérico de "segurança", não a nossa marca. Se a logo precisar mudar,
// muda em `public/logo.png` e este script propaga.
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destino = resolve(raiz, 'extension/icons');
const origem = resolve(raiz, 'public/logo.png');
mkdirSync(destino, { recursive: true });

for (const lado of [16, 32, 48, 128]) {
  // A logo já vem como ícone: quadrada, com cantos arredondados e fundo
  // próprio. Só precisa ser redimensionada — qualquer moldura extra criaria um
  // anel em volta, duas bordas concêntricas.
  const png = await sharp(origem).resize(lado, lado, { fit: 'cover' }).png().toBuffer();
  writeFileSync(resolve(destino, `icon-${lado}.png`), png);
  console.log(`icon-${lado}.png`);
}

// Uma cópia em tamanho cheio para a tela de login do popup, que mostra a marca
// maior do que o ícone da barra comporta.
copyFileSync(origem, resolve(destino, 'logo.png'));
writeFileSync(
  resolve(destino, 'icon.svg'),
  `<!-- Os PNGs desta pasta saem de public/logo.png, pelo
     scripts/render-authenticator-icons.mjs. Não edite à mão. -->\n`,
);

console.log('pronto — logo oficial do escritório');
