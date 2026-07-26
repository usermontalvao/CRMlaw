/**
 * CollabE2EHarness
 * -----------------------------------------------------------------------------
 * Página de teste de PONTA A PONTA da coedição — dois navegadores digitando no
 * mesmo .docx, contra o servidor `collab` REAL (com Redis real e um Nextcloud
 * de teste). Não faz parte do CRM em produção: existe para provar, fora do
 * ambiente logado, que o caminho inteiro funciona:
 *
 *   contentChange → sendActionToServer → UpdateAction → SignalR →
 *   applyRemoteAction → SaveToSource → .docx gravado.
 *
 * A fiação replicada aqui é EXATAMENTE a de `SyncfusionEditor.tsx`
 * (joinCollabRoom/handleContentChange) usando as mesmas funções de
 * `syncfusionCollab.service`. Se a ordem de inicialização de lá mudar, mude
 * aqui junto.
 *
 * Como usar (ver também o roteiro em docs, ou o histórico do commit):
 *   1. suba Redis, o stub de Nextcloud e o servidor collab com Auth__Require=false;
 *   2. empacote este arquivo com esbuild definindo VITE_SYNCFUSION_COLLAB_URL;
 *   3. abra `harness.html?user=Ana&file=e2e/peticao.docx` em duas abas.
 *
 * A página expõe `window.__collab` para o roteiro de teste dirigir o editor.
 */
import {
  DocumentEditor,
  Editor,
  Selection,
  EditorHistory,
  SfdtExport,
  CollaborativeEditingHandler,
  type Operation,
  type ActionInfo,
} from '@syncfusion/ej2-react-documenteditor';
import { syncCollabCaretFlags } from '../components/collabCaretFlags';
import {
  collabApiUrl,
  connectToCollabRoom,
  flushCollabRoom,
  importCollabDocument,
  isCollabEnabled,
  roomNameForPath,
  type CollabConnection,
  type CollabPeer,
  type CollabSaveOutcome,
  type CollabStatus,
} from '../services/syncfusionCollab.service';

// Mesma regra do SyncfusionEditor: o módulo de coedição é injetado UMA vez, no
// carregamento do módulo, ANTES de qualquer instância do editor ser criada.
DocumentEditor.Inject(Editor, Selection, EditorHistory, SfdtExport, CollaborativeEditingHandler);

interface HarnessApi {
  ready: boolean;
  status: CollabStatus;
  peers: CollabPeer[];
  roomName: string;
  received: number;
  sent: number;
  /** Último aviso de gravação recebido da sala (evento `saved`). */
  saved: CollabSaveOutcome | null;
  type: (text: string) => void;
  text: () => string;
  flush: () => Promise<CollabSaveOutcome>;
  stop: () => Promise<void>;
}

declare global {
  interface Window {
    __collab?: HarnessApi;
    __collabError?: string;
  }
}

async function start(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const userName = params.get('user') || 'Usuário de teste';
  const filePath = params.get('file') || 'e2e/peticao.docx';
  const fileName = filePath.split('/').pop() || 'peticao.docx';

  if (!isCollabEnabled()) {
    throw new Error('VITE_SYNCFUSION_COLLAB_URL não definida no bundle do harness.');
  }

  const editor = new DocumentEditor({
    height: '600px',
    isReadOnly: false,
    enableEditor: true,
    enableSelection: true,
    enableEditorHistory: true,
    enableSfdtExport: true,
  });
  editor.appendTo('#editor');

  // Ordem idêntica ao joinCollabRoom do SyncfusionEditor.tsx.
  const roomName = await roomNameForPath(filePath);
  const document = await importCollabDocument({ roomName, filePath, fileName });

  editor.enableCollaborativeEditing = true;
  editor.currentUser = userName;
  editor.dataBind();

  const handler = editor.collaborativeEditingHandlerModule;
  if (!handler) throw new Error('O módulo de coedição do Syncfusion não carregou.');

  handler.updateRoomInfo(roomName, document.version, collabApiUrl());
  editor.open(document.sfdt);

  let connection: CollabConnection | null = null;

  const api: HarnessApi = {
    ready: false,
    status: 'off',
    peers: [],
    roomName,
    received: 0,
    sent: 0,
    saved: null,
    type: (text: string) => {
      editor.editor.insertText(text);
    },
    text: () => {
      editor.selection.selectAll();
      const value = editor.selection.text;
      editor.selection.moveToDocumentEnd();
      return value;
    },
    flush: () => flushCollabRoom({ roomName, filePath }),
    stop: async () => connection?.stop(),
  };
  window.__collab = api;

  // Mesmo espelho do handleContentChange do SyncfusionEditor.tsx.
  editor.contentChange = (args: { operations?: unknown[] }) => {
    const operations = args?.operations;
    if (Array.isArray(operations) && operations.length > 0) {
      handler.sendActionToServer(operations as Operation[]);
      api.sent += operations.length;
      connection?.notifyTyping();
    }
  };

  connection = await connectToCollabRoom({
    roomName,
    member: { userName, userId: userName },
    callbacks: {
      onData: (action, data) => {
        if (action === 'action') api.received += 1;
        handler.applyRemoteAction(action, data as string | ActionInfo);
      },
      onPeersChange: (peers) => {
        api.peers = peers;
        // Plaquinha nome+foto no cursor de cada pessoa — mesmo caminho do CRM.
        syncCollabCaretFlags(handler, peers.map((peer) => ({
          connectionId: peer.connectionId,
          userName: peer.userName,
          avatarUrl: null,
          typing: peer.typing,
        })));
      },
      onStatusChange: (status) => {
        api.status = status;
      },
      onSaved: (outcome) => {
        api.saved = outcome;
      },
    },
  });

  api.ready = true;
  const badge = window.document.getElementById('status');
  if (badge) badge.textContent = `pronto · sala ${roomName.slice(0, 12)}… · ${userName}`;
}

start().catch((error: unknown) => {
  window.__collabError = String((error as Error)?.message || error);
  const badge = window.document.getElementById('status');
  if (badge) badge.textContent = `ERRO: ${window.__collabError}`;
});
