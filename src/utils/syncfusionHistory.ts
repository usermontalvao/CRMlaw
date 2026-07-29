type SyncfusionEditorHistory = {
  lastOperation?: unknown;
  currentBaseHistoryInfo?: unknown;
  historyInfoStack?: unknown[];
};

type SyncfusionEditorWithHistory = {
  editorHistoryModule?: SyncfusionEditorHistory;
};

/**
 * Removes transient history entries left behind by Syncfusion after replacing
 * the document.
 *
 * In EJ2 32.1.21, DocumentHelper.onDocumentChanged() destroys the undo/redo
 * stacks, but EditorHistory.destroy() does not clear these three references.
 * A later collaborative content change can therefore call getActionInfo() on
 * a destroyed BaseHistoryInfo whose owner has already been removed.
 */
export const resetSyncfusionHistoryAfterDocumentLoad = (
  editor: SyncfusionEditorWithHistory | null | undefined,
): boolean => {
  const history = editor?.editorHistoryModule;
  if (!history) return false;

  history.lastOperation = undefined;
  history.currentBaseHistoryInfo = undefined;
  if (Array.isArray(history.historyInfoStack)) {
    history.historyInfoStack.length = 0;
  }

  return true;
};
