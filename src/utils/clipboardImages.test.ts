import test from 'node:test';
import assert from 'node:assert/strict';
import { isPastedImage, extensionForImage, pastedImageName, imagesFromClipboard } from './clipboardImages.ts';

/** Área de transferência falsa com a mesma forma que o navegador entrega. */
const clipboard = (opts: { files?: File[]; items?: Array<{ kind: string; type: string; file: File | null }> }) => ({
  files: opts.files ?? [],
  items: (opts.items ?? []).map(it => ({ kind: it.kind, type: it.type, getAsFile: () => it.file })),
}) as unknown as DataTransfer;

const png = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });

test('reconhece imagem colada e descarta o que não é imagem', () => {
  assert.equal(isPastedImage('image/png'), true);
  assert.equal(isPastedImage('image/JPEG'), true);
  assert.equal(isPastedImage('text/plain'), false);
  assert.equal(isPastedImage('application/pdf'), false);
  assert.equal(isPastedImage(null), false);
  // SVG cola como imagem mas o WhatsApp não renderiza.
  assert.equal(isPastedImage('image/svg+xml'), false);
});

test('deriva a extensão pelo MIME', () => {
  assert.equal(extensionForImage('image/jpeg'), 'jpg');
  assert.equal(extensionForImage('image/webp'), 'webp');
  assert.equal(extensionForImage('image/gif'), 'gif');
  assert.equal(extensionForImage('image/png'), 'png');
  // Desconhecido cai em png, que é o formato do print da tela.
  assert.equal(extensionForImage(''), 'png');
});

test('renomeia print sem nome útil com a data e a hora da colagem', () => {
  const now = new Date(2026, 7, 5, 9, 4, 7); // 05/08/2026 09:04:07
  assert.equal(pastedImageName('image.png', 'image/png', now), 'print-2026-08-05-09-04-07.png');
  assert.equal(pastedImageName('', 'image/jpeg', now), 'print-2026-08-05-09-04-07.jpg');
  assert.equal(pastedImageName('Screenshot.png', 'image/png', now), 'print-2026-08-05-09-04-07.png');
  // Chrome numera prints repetidos na mesma sessão.
  assert.equal(pastedImageName('image (2).png', 'image/png', now), 'print-2026-08-05-09-04-07.png');
});

test('preserva o nome de um arquivo copiado de verdade', () => {
  const now = new Date(2026, 7, 5, 9, 4, 7);
  assert.equal(pastedImageName('comprovante-inss.png', 'image/png', now), 'comprovante-inss.png');
  assert.equal(pastedImageName('RG frente.jpg', 'image/jpeg', now), 'RG frente.jpg');
});

const agora = new Date(2026, 7, 5, 9, 4, 7);

test('print da tela: imagem só em items, com files vazio', () => {
  // É esta a forma que a captura de tela assume em boa parte dos navegadores.
  // Ler apenas `files` fazia a colagem falhar em silêncio.
  const dt = clipboard({ files: [], items: [{ kind: 'file', type: 'image/png', file: png('image.png') }] });
  const out = imagesFromClipboard(dt, agora);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'print-2026-08-05-09-04-07.png');
  assert.equal(out[0].type, 'image/png');
});

test('imagem em files é aceita do mesmo jeito', () => {
  const dt = clipboard({ files: [png('image.png')] });
  const out = imagesFromClipboard(dt, agora);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'print-2026-08-05-09-04-07.png');
});

test('não duplica quando o navegador preenche files E items', () => {
  const f = png('image.png');
  const dt = clipboard({ files: [f], items: [{ kind: 'file', type: 'image/png', file: f }] });
  assert.equal(imagesFromClipboard(dt, agora).length, 1);
});

test('colagem de texto puro não vira anexo', () => {
  const dt = clipboard({ items: [{ kind: 'string', type: 'text/plain', file: null }] });
  assert.deepEqual(imagesFromClipboard(dt, agora), []);
  assert.deepEqual(imagesFromClipboard(null, agora), []);
});

test('item de arquivo que não é imagem é ignorado', () => {
  const pdf = new File([new Uint8Array([1])], 'peticao.pdf', { type: 'application/pdf' });
  const dt = clipboard({ files: [], items: [{ kind: 'file', type: 'application/pdf', file: pdf }] });
  assert.deepEqual(imagesFromClipboard(dt, agora), []);
});
