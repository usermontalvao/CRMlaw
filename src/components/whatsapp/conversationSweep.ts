// A varredura que anuncia que uma conversa saiu da fila — encerrada ou
// transferida.
//
// Fica num módulo só seu porque o tempo dela é um CONTRATO entre três lugares
// que não se enxergam: a animação em `index.css`, a linha que a desenha
// (`conversationListItem`) e o hook que segura a conversa na lista enquanto ela
// corre (`useWaOperationalModals`). Espalhar o número por esses três arquivos
// seria garantir que um dia dois deles discordem — e a discordância aparece
// como linha que pisca de volta no meio da despedida.

/** O que a faixa está anunciando. */
export type WaSweepKind = 'closed' | 'transferred';

/**
 * Duração da varredura, em milissegundos. Precisa bater com `wa-varredura`,
 * `wa-varredura-texto` e `wa-conv-saindo` no `index.css`.
 */
export const WA_SWEEP_MS = 600;

/**
 * Quanto esperar antes de deixar a conversa sair da lista.
 *
 * Zero para quem pediu menos movimento no sistema: sem animação para assistir,
 * segurar a linha por seis décimos de segundo é só atraso — a lista volta a se
 * comportar como antes desta funcionalidade existir.
 */
export function waSweepDelay(): number {
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return 0;
  } catch { /* ambiente sem matchMedia: segue com a animação */ }
  return WA_SWEEP_MS;
}

/** Texto e cores da faixa. Verde de concluído; violeta de "mudou de mãos". */
export const WA_SWEEP_META: Record<WaSweepKind, { label: string; bg: string; fg: string }> = {
  closed: { label: 'Atendimento encerrado', bg: '#ecfdf5', fg: '#0f6e56' },
  transferred: { label: 'Conversa transferida', bg: '#f5f3ff', fg: '#5b21b6' },
};
