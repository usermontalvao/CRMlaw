import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTHENTICATOR_EXTENSION_ID,
  AUTHENTICATOR_EXTENSION_MARKER,
  detectarExtensaoAuthenticator,
} from './authenticatorExtension.ts';

function imagemQue(resultado: 'carrega' | 'falha' | 'silencia') {
  const imagem: any = { onload: null, onerror: null };
  Object.defineProperty(imagem, 'src', {
    set() {
      if (resultado === 'silencia') return;
      queueMicrotask(() => resultado === 'carrega' ? imagem.onload?.() : imagem.onerror?.());
    },
  });
  return imagem;
}

test('o marcador aponta para o ID fixo da extensão', () => {
  assert.match(AUTHENTICATOR_EXTENSION_ID, /^[a-p]{32}$/);
  assert.equal(
    AUTHENTICATOR_EXTENSION_MARKER,
    `chrome-extension://${AUTHENTICATOR_EXTENSION_ID}/icons/icon-16.png`,
  );
});

test('detecta a extensão somente quando o marcador carrega', async () => {
  assert.equal(await detectarExtensaoAuthenticator(() => imagemQue('carrega'), 50), true);
  assert.equal(await detectarExtensaoAuthenticator(() => imagemQue('falha'), 50), false);
});

test('navegador que ignora o protocolo não deixa a verificação pendurada', async () => {
  assert.equal(await detectarExtensaoAuthenticator(() => imagemQue('silencia'), 1), false);
});
