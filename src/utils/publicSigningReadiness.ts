export type PublicSigningOpeningState = {
  step: 'loading' | 'success' | 'error' | 'already_signed';
  hasSigner: boolean;
  hasRequest: boolean;
  mainDocumentLoaded: boolean;
};

/** A cortina inicial pode sair assim que o documento principal está legível. */
export function isPublicSigningReaderReady(state: PublicSigningOpeningState): boolean {
  return state.step === 'success'
    && state.hasSigner
    && state.hasRequest
    && state.mainDocumentLoaded;
}

/**
 * Abrir a identificação exige mais: a lista de anexos precisa ter sido
 * resolvida e os DOCX precisam estar renderizados (ou ter alcançado o prazo de
 * segurança). Assim a leitura abre cedo sem permitir assinar um kit incompleto.
 */
export function canOpenPublicSigningModal(params: {
  readerReady: boolean;
  attachmentManifestReady: boolean;
  allAttachmentsRendered: boolean;
  loadDeadlineReached: boolean;
}): boolean {
  return params.readerReady
    && params.attachmentManifestReady
    && (params.allAttachmentsRendered || params.loadDeadlineReached);
}
