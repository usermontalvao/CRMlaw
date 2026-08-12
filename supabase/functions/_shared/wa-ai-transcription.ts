/**
 * Garante que o turno de IA de um áudio comece somente depois da tentativa de
 * transcrição. A transcrição já roda como tarefa de fundo no webhook; esta
 * função apenas ordena as duas tarefas dentro do mesmo `waitUntil`.
 *
 * Mesmo se a transcrição falhar, a IA é acionada e recebe o marcador `[áudio]`.
 */
export async function triggerWaAiAfterTranscription(
  transcriptionJob: Promise<unknown> | null,
  trigger: () => Promise<unknown>,
): Promise<void> {
  if (transcriptionJob) {
    try { await transcriptionJob; } catch { /* o turno ainda precisa acontecer */ }
  }
  await trigger();
}
