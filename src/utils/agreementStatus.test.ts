import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { deriveAgreementStatus } from './agreementStatus.ts';

describe('deriveAgreementStatus', () => {
  it('conclui um lançamento ativo quando todas as parcelas estão pagas', () => {
    assert.equal(
      deriveAgreementStatus('ativo', [{ status: 'pago' }, { status: 'pago' }]),
      'concluido',
    );
  });

  it('não conclui um lançamento sem parcelas', () => {
    assert.equal(deriveAgreementStatus('ativo', []), 'ativo');
  });

  it('mantém ativo enquanto houver parcela pendente', () => {
    assert.equal(
      deriveAgreementStatus('ativo', [{ status: 'pago' }, { status: 'pendente' }]),
      'ativo',
    );
  });

  it('preserva estados administrativos mesmo com todas as parcelas pagas', () => {
    const paid = [{ status: 'pago' as const }];
    assert.equal(deriveAgreementStatus('cancelado', paid), 'cancelado');
    assert.equal(deriveAgreementStatus('aguardando_definicao', paid), 'aguardando_definicao');
  });
});
