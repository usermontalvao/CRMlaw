import test from 'node:test';
import assert from 'node:assert/strict';
import { signatureListChip, type SignatureChipInput } from './signatureChip.ts';

const status = (patch: Partial<SignatureChipInput>): SignatureChipInput => ({
  kind: 'signature_signed',
  label: 'Assinado',
  ...patch,
});

test('assinou vira chip verde na linha da inbox', () => {
  const chip = signatureListChip(status({ kind: 'signature_signed', label: 'Assinado' }));
  assert.equal(chip?.label, 'Assinado');
  assert.equal(chip?.icon, 'signed');
  assert.equal(chip?.title, 'O cliente assinou o documento');
});

test('recusou tem chip próprio, e não some junto com o assinado', () => {
  const chip = signatureListChip(status({ kind: 'signature_refused', label: 'Recusado' }));
  assert.equal(chip?.label, 'Recusou');
  assert.equal(chip?.icon, 'refused');
});

test('o que só nós fizemos não acende a linha', () => {
  assert.equal(signatureListChip(status({ kind: 'fill_sent', label: 'Link enviado' })), null);
  assert.equal(signatureListChip(status({ kind: 'signature_pending', label: 'Aguardando assinatura' })), null);
});

test('sem acompanhamento não há chip', () => {
  assert.equal(signatureListChip(null), null);
  assert.equal(signatureListChip(undefined), null);
});

test('a frase longa do serviço fica no title, não no rótulo', () => {
  const chip = signatureListChip(status({
    kind: 'signature_viewed',
    label: 'Saiu sem assinar — visto por último hoje às 14:32',
  }));
  assert.equal(chip?.label, 'Saiu sem assinar');
  assert.equal(chip?.title, 'Saiu sem assinar — visto por último hoje às 14:32');
});

test('rótulo igual ao curto cai na frase explicativa', () => {
  const chip = signatureListChip(status({ kind: 'fill_live', label: 'Preenchendo' }));
  assert.equal(chip?.title, 'O cliente está preenchendo o kit agora');
});
