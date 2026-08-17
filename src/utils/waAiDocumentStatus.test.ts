import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderWaAiDocumentStatus } from './waAiDocumentStatus.ts';

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waAiDocumentStatus.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-document-status.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-document-status.ts divergiu — copie o arquivo inteiro');
});

const ID = 'Documento de identificação com foto do cliente';
const PRINT = 'Print, e-mail ou tela mostrando o bloqueio ou encerramento da conta';
const RESID = 'Comprovante de residência (conta de luz, água, telefone ou internet)';

// ── A mensagem que quebrou em produção ──────────────────────────────────────
//
// "Recebemos seu documento de identificação e o comprovante de residência. Por
// favor, envie agora apenas o documento de identificação com foto do cliente,
// se ainda não enviou." — agradece e cobra o MESMO item na frase seguinte.

test('o que já chegou nunca é cobrado de novo', () => {
  const texto = renderWaAiDocumentStatus({
    items: [
      { label: ID, status: 'approved' },
      { label: RESID, status: 'uploaded' },
      { label: PRINT, status: 'pending' },
    ],
  });
  assert.match(texto, /Ainda falta este aqui/);
  assert.ok(texto.includes(`• ${PRINT}`));
  // O par que se contradizia: nenhum dos dois recebidos pode aparecer na lista.
  assert.equal(texto.includes(ID), false);
  assert.equal(texto.includes(RESID), false);
});

test('vários pendentes saem um por linha, com marcador', () => {
  const texto = renderWaAiDocumentStatus({
    items: [
      { label: ID, status: 'approved' },
      { label: RESID, status: 'pending' },
      { label: PRINT, status: 'pending' },
    ],
  });
  assert.match(texto, /Ainda faltam estes/);
  assert.equal(texto.split('\n').filter(linha => linha.startsWith('• ')).length, 2);
  assert.match(texto, /um de cada vez/);
});

test('primeira cobrança não agradece um envio que não houve', () => {
  const texto = renderWaAiDocumentStatus({
    items: [
      { label: ID, status: 'pending' },
      { label: RESID, status: 'pending' },
      { label: PRINT, status: 'pending' },
    ],
  });
  assert.match(texto, /^Para seguir, ainda preciso destes documentos:/);
  assert.doesNotMatch(texto, /Recebi, obrigado/);
});

test('tudo entregue encerra a cobrança em vez de repetir a lista', () => {
  const texto = renderWaAiDocumentStatus({
    items: [
      { label: ID, status: 'approved' },
      { label: RESID, status: 'reviewed' },
      { label: PRINT, status: 'uploaded' },
    ],
  });
  assert.match(texto, /Recebi todos os documentos/);
  assert.equal(texto.includes('•'), false);
});

test('arquivo ainda não conferido cala a lista inteira', () => {
  // A precedência que evita o pior caso: cobrar de quem acabou de enviar. A
  // lista do banco é anterior ao que a pessoa mandou trinta segundos atrás.
  const texto = renderWaAiDocumentStatus({
    aguardandoTriagem: true,
    items: [
      { label: ID, status: 'pending' },
      { label: RESID, status: 'pending' },
      { label: PRINT, status: 'pending' },
    ],
  });
  assert.match(texto, /já estou conferindo/);
  assert.equal(texto.includes('•'), false);
  assert.equal(texto.includes(ID), false);
});

test('sem itens não há mensagem para dar', () => {
  assert.equal(renderWaAiDocumentStatus({ items: [] }), '');
  assert.equal(renderWaAiDocumentStatus({ items: [{ label: '  ', status: 'pending' }] }), '');
});
