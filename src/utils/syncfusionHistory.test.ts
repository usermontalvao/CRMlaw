import assert from 'node:assert/strict';
import test from 'node:test';

import { resetSyncfusionHistoryAfterDocumentLoad } from './syncfusionHistory.ts';

test('clears transient Syncfusion history after a document replacement', () => {
  const historyInfoStack = [{ owner: undefined }, { owner: undefined }];
  const editor = {
    editorHistoryModule: {
      lastOperation: { owner: undefined },
      currentBaseHistoryInfo: { owner: undefined },
      historyInfoStack,
    },
  };

  assert.equal(resetSyncfusionHistoryAfterDocumentLoad(editor), true);
  assert.equal(editor.editorHistoryModule.lastOperation, undefined);
  assert.equal(editor.editorHistoryModule.currentBaseHistoryInfo, undefined);
  assert.equal(historyInfoStack.length, 0);
});

test('is safe before the editor history module exists', () => {
  assert.equal(resetSyncfusionHistoryAfterDocumentLoad(undefined), false);
  assert.equal(resetSyncfusionHistoryAfterDocumentLoad({}), false);
});
