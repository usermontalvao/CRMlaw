import type { AgreementStatus, InstallmentStatus } from '../types/financial.types';

type InstallmentStatusInput = Pick<{ status: InstallmentStatus }, 'status'>;

const NON_OPERATIONAL_STATUSES: AgreementStatus[] = ['cancelado', 'aguardando_definicao'];

/**
 * Mantém o status do lançamento coerente com suas parcelas.
 *
 * Um lançamento encerrado administrativamente não deve ser alterado pela
 * situação das parcelas. Nos demais casos, ao existir ao menos uma parcela e
 * todas estarem pagas, o lançamento necessariamente está concluído.
 */
export const deriveAgreementStatus = (
  requestedStatus: AgreementStatus,
  installments: InstallmentStatusInput[],
): AgreementStatus => {
  if (NON_OPERATIONAL_STATUSES.includes(requestedStatus)) return requestedStatus;

  const isFullyPaid = installments.length > 0 && installments.every(({ status }) => status === 'pago');
  return isFullyPaid ? 'concluido' : requestedStatus;
};
