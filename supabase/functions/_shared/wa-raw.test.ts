import assert from 'node:assert/strict';
import test from 'node:test';
import { RAW_MAX_STRING, slimWaRaw } from './wa-raw.ts';

test('tira a mídia embutida mas preserva key e message', () => {
  const payload = {
    key: { id: 'ABC', remoteJid: '5565999@s.whatsapp.net', fromMe: false },
    pushName: 'Maria',
    message: {
      base64: 'A'.repeat(500_000),
      imageMessage: {
        mimetype: 'image/jpeg',
        caption: 'contrato assinado',
        jpegThumbnail: 'B'.repeat(20_000),
        url: 'https://mmg.whatsapp.net/x',
      },
    },
  };

  const slim = slimWaRaw(payload) as any;

  // evolution-send depende destes dois para citar e editar mensagem.
  assert.deepEqual(slim.key, payload.key);
  assert.equal(slim.message.imageMessage.caption, 'contrato assinado');
  assert.equal(slim.message.imageMessage.mimetype, 'image/jpeg');
  assert.equal(slim.message.imageMessage.url, 'https://mmg.whatsapp.net/x');
  assert.equal(slim.pushName, 'Maria');

  assert.equal('base64' in slim.message, false);
  assert.equal('jpegThumbnail' in slim.message.imageMessage, false);
});

test('não muta o payload original — o webhook ainda lê o base64 dele', () => {
  const payload = { message: { base64: 'AAAA', imageMessage: { jpegThumbnail: 'BB' } } };
  slimWaRaw(payload);
  assert.equal(payload.message.base64, 'AAAA');
  assert.equal(payload.message.imageMessage.jpegThumbnail, 'BB');
});

test('alcança blob aninhado em mensagem citada', () => {
  const slim = slimWaRaw({
    message: {
      extendedTextMessage: {
        text: 'olha isso',
        contextInfo: {
          stanzaId: 'XYZ',
          quotedMessage: { imageMessage: { jpegThumbnail: 'C'.repeat(10_000) } },
        },
      },
    },
  }) as any;

  const ctx = slim.message.extendedTextMessage.contextInfo;
  assert.equal(ctx.stanzaId, 'XYZ');
  assert.equal('jpegThumbnail' in ctx.quotedMessage.imageMessage, false);
});

test('trunca string gigante em campo desconhecido (rede de segurança)', () => {
  const slim = slimWaRaw({ campoNovoDaEvolution: 'D'.repeat(RAW_MAX_STRING + 100) }) as any;
  assert.equal(slim.campoNovoDaEvolution.startsWith('D'.repeat(RAW_MAX_STRING)), true);
  assert.equal(slim.campoNovoDaEvolution.endsWith('…[+100]'), true);
});

test('texto de conversa normal passa intacto', () => {
  const texto = 'Bom dia, doutor. Preciso saber do andamento do meu processo.';
  const slim = slimWaRaw({ message: { conversation: texto } }) as any;
  assert.equal(slim.message.conversation, texto);
});

test('preserva tipos primitivos, nulos e listas', () => {
  const slim = slimWaRaw({
    messageTimestamp: 1_770_000_000,
    status: null,
    contextInfo: { mentionedJid: ['a@s.whatsapp.net', 'b@s.whatsapp.net'] },
    fromMe: true,
  }) as any;
  assert.equal(slim.messageTimestamp, 1_770_000_000);
  assert.equal(slim.status, null);
  assert.deepEqual(slim.contextInfo.mentionedJid, ['a@s.whatsapp.net', 'b@s.whatsapp.net']);
  assert.equal(slim.fromMe, true);
});
