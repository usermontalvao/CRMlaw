import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canOpenPublicSigningModal,
  isPublicSigningReaderReady,
} from './publicSigningReadiness.ts';

test('o iPhone mostra o documento principal sem esperar baixar todos os anexos', () => {
  const readerReady = isPublicSigningReaderReady({
    step: 'success',
    hasSigner: true,
    hasRequest: true,
    mainDocumentLoaded: true,
  });

  assert.equal(readerReady, true);
  assert.equal(canOpenPublicSigningModal({
    readerReady,
    attachmentManifestReady: true,
    allAttachmentsRendered: false,
    loadDeadlineReached: false,
  }), false, 'o documento aparece, mas o botão ainda aguarda os anexos');
});

test('a identificação abre quando todos os documentos estão prontos', () => {
  assert.equal(canOpenPublicSigningModal({
    readerReady: true,
    attachmentManifestReady: true,
    allAttachmentsRendered: true,
    loadDeadlineReached: false,
  }), true);
});

test('a identificação nunca abre antes de resolver quais anexos pertencem ao kit', () => {
  assert.equal(canOpenPublicSigningModal({
    readerReady: true,
    attachmentManifestReady: false,
    allAttachmentsRendered: true,
    loadDeadlineReached: true,
  }), false);
});
