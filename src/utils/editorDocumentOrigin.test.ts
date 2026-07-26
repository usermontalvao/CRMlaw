// Cobertura das regras puras de origem/salvamento do editor de petições.
// Execução: `npx ts-node --esm src/utils/editorDocumentOrigin.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeFileNameSegment,
  normalizeDocxFileName,
  normalizeNextcloudDirPath,
  buildNextcloudFilePath,
  parentPathOf,
  fileNameOf,
  crumbsOf,
  isSupportedEditorFileName,
  compareExplorerEntries,
  decideSaveTarget,
  saveNeedsDestination,
  originAfterSaveAs,
  originAfterSaveCopy,
  originAfterDownloadCopy,
  activeNextcloudPath,
  activeNextcloudEtag,
  detectOverwrite,
  describeOrigin,
  savedLabelFor,
  type ActiveDocumentOrigin,
} from './editorDocumentOrigin.ts';

// --- Nomes ------------------------------------------------------------------

test('sanitizeFileNameSegment remove barras e caracteres reservados', () => {
  assert.equal(sanitizeFileNameSegment('a/b\\c:d*e?f"g<h>i|j'), 'a b c d e f g h i j');
  assert.equal(sanitizeFileNameSegment('  Contrato  final  '), 'Contrato final');
  assert.equal(sanitizeFileNameSegment('...nome...'), 'nome');
  assert.equal(sanitizeFileNameSegment('///'), '');
});

test('sanitizeFileNameSegment preserva hífen, acento e underscore', () => {
  assert.equal(sanitizeFileNameSegment('Petição-Inicial_v2'), 'Petição-Inicial_v2');
});

test('normalizeDocxFileName acrescenta .docx quando falta', () => {
  assert.equal(normalizeDocxFileName('Petição inicial'), 'Petição inicial.docx');
  assert.equal(normalizeDocxFileName('Contrato.docx'), 'Contrato.docx');
  assert.equal(normalizeDocxFileName('Contrato.DOCX'), 'Contrato.docx');
});

test('normalizeDocxFileName nunca devolve nome vazio', () => {
  assert.equal(normalizeDocxFileName(''), 'documento.docx');
  assert.equal(normalizeDocxFileName('   '), 'documento.docx');
  assert.equal(normalizeDocxFileName('.docx'), 'documento.docx');
  assert.equal(normalizeDocxFileName('', 'Sem título'), 'Sem título.docx');
});

test('normalizeDocxFileName impede barras no nome', () => {
  assert.equal(normalizeDocxFileName('pasta/arquivo'), 'pasta arquivo.docx');
  assert.ok(!normalizeDocxFileName('a/b/c.docx').includes('/'));
});

// --- Caminhos ---------------------------------------------------------------

test('normalizeNextcloudDirPath remove travessia e barras extras', () => {
  assert.equal(normalizeNextcloudDirPath('/Clientes//2026/'), 'Clientes/2026');
  assert.equal(normalizeNextcloudDirPath('Clientes/../../etc'), 'Clientes/etc');
  assert.equal(normalizeNextcloudDirPath('./'), '');
  assert.equal(normalizeNextcloudDirPath(''), '');
});

test('buildNextcloudFilePath monta o destino com segurança', () => {
  assert.equal(buildNextcloudFilePath('Clientes/2026', 'peticao.docx'), 'Clientes/2026/peticao.docx');
  assert.equal(buildNextcloudFilePath('', 'peticao.docx'), 'peticao.docx');
  assert.equal(buildNextcloudFilePath('/Clientes/', 'peticao.docx'), 'Clientes/peticao.docx');
});

test('buildNextcloudFilePath neutraliza tentativa de escapar da pasta', () => {
  assert.equal(buildNextcloudFilePath('Clientes', '../../root.docx'), 'Clientes/root.docx');
  assert.throws(() => buildNextcloudFilePath('Clientes', '///'), /nome de arquivo válido/);
});

test('parentPathOf e fileNameOf separam pasta e arquivo', () => {
  assert.equal(parentPathOf('Clientes/2026/peticao.docx'), 'Clientes/2026');
  assert.equal(parentPathOf('peticao.docx'), '');
  assert.equal(fileNameOf('Clientes/2026/peticao.docx'), 'peticao.docx');
  assert.equal(fileNameOf(''), '');
});

test('crumbsOf gera segmentos cumulativos', () => {
  assert.deepEqual(crumbsOf('Clientes/2026'), [
    { label: 'Clientes', path: 'Clientes' },
    { label: '2026', path: 'Clientes/2026' },
  ]);
  assert.deepEqual(crumbsOf(''), []);
});

// --- Filtro de arquivos suportados ------------------------------------------

test('isSupportedEditorFileName aceita apenas .docx reais', () => {
  assert.equal(isSupportedEditorFileName('peticao.docx'), true);
  assert.equal(isSupportedEditorFileName('PETICAO.DOCX'), true);
  assert.equal(isSupportedEditorFileName('peticao.pdf'), false);
  assert.equal(isSupportedEditorFileName('peticao.doc'), false);
  assert.equal(isSupportedEditorFileName('~$peticao.docx'), false);
  assert.equal(isSupportedEditorFileName(''), false);
});

test('compareExplorerEntries coloca pastas antes e ordena em pt-BR', () => {
  const entries = [
    { name: 'zebra.docx', isDir: false },
    { name: 'Ávila', isDir: true },
    { name: 'antonio.docx', isDir: false },
    { name: 'banco', isDir: true },
  ];
  assert.deepEqual(
    [...entries].sort(compareExplorerEntries).map((e) => e.name),
    ['Ávila', 'banco', 'antonio.docx', 'zebra.docx'],
  );
});

// --- Destino do Ctrl+S ------------------------------------------------------

const nextcloudOrigin: ActiveDocumentOrigin = {
  kind: 'nextcloud',
  path: 'Clientes/2026/peticao.docx',
  fileName: 'peticao.docx',
  etag: 'W/"abc"',
};

test('decideSaveTarget grava direto no Nextcloud quando o doc veio de lá', () => {
  assert.deepEqual(decideSaveTarget(nextcloudOrigin), {
    action: 'nextcloud',
    path: 'Clientes/2026/peticao.docx',
    fileName: 'peticao.docx',
    etag: 'W/"abc"',
  });
});

test('decideSaveTarget mantém a petição do Jurius', () => {
  assert.deepEqual(decideSaveTarget({ kind: 'petition', petitionId: 'p1' }), {
    action: 'petition',
    petitionId: 'p1',
  });
});

test('decideSaveTarget mantém a origem externa', () => {
  const source = { type: 'template-file', fileId: 'f1' } as const;
  assert.deepEqual(decideSaveTarget({ kind: 'external', source, fileName: 'modelo.docx' }), {
    action: 'external',
    source,
    fileName: 'modelo.docx',
  });
});

test('decideSaveTarget pergunta o destino quando não há origem', () => {
  assert.deepEqual(decideSaveTarget({ kind: 'new' }), { action: 'ask' });
  assert.equal(saveNeedsDestination({ kind: 'new' }), true);
  assert.equal(saveNeedsDestination(nextcloudOrigin), false);
});

test('decideSaveTarget não pergunta quando já existe petição persistida', () => {
  assert.deepEqual(decideSaveTarget({ kind: 'new' }, { hasPersistedPetition: true }), {
    action: 'petition',
    petitionId: null,
  });
  assert.equal(saveNeedsDestination({ kind: 'new' }, { hasPersistedPetition: true }), false);
});

// --- Troca de origem --------------------------------------------------------

test('"Salvar como" troca a origem ativa para o novo caminho', () => {
  const next = originAfterSaveAs('Modelos/copia.docx', 'W/"nova"');
  assert.deepEqual(next, {
    kind: 'nextcloud',
    path: 'Modelos/copia.docx',
    fileName: 'copia.docx',
    etag: 'W/"nova"',
  });
  assert.deepEqual(decideSaveTarget(next).action, 'nextcloud');
});

test('"Salvar uma cópia" e "Baixar uma cópia" NÃO trocam a origem ativa', () => {
  assert.deepEqual(originAfterSaveCopy(nextcloudOrigin), nextcloudOrigin);
  assert.deepEqual(originAfterDownloadCopy(nextcloudOrigin), nextcloudOrigin);
  assert.deepEqual(originAfterDownloadCopy({ kind: 'new' }), { kind: 'new' });
});

test('lock e ETag acompanham a origem ativa', () => {
  assert.equal(activeNextcloudPath(nextcloudOrigin), 'Clientes/2026/peticao.docx');
  assert.equal(activeNextcloudEtag(nextcloudOrigin), 'W/"abc"');
  assert.equal(activeNextcloudPath({ kind: 'petition', petitionId: 'p1' }), null);
  assert.equal(activeNextcloudEtag({ kind: 'new' }), null);
  assert.equal(activeNextcloudEtag({ kind: 'nextcloud', path: 'a.docx', fileName: 'a.docx' }), null);
});

// --- Sobrescrita ------------------------------------------------------------

test('detectOverwrite acusa colisão ignorando maiúsculas', () => {
  const existing = ['Peticao.docx', 'outro.docx'];
  assert.equal(detectOverwrite(existing, 'peticao.docx'), true);
  assert.equal(detectOverwrite(existing, 'novo.docx'), false);
  assert.equal(detectOverwrite(existing, ''), false);
});

// --- Rótulos ----------------------------------------------------------------

test('describeOrigin mostra a procedência do documento', () => {
  assert.deepEqual(describeOrigin(nextcloudOrigin), {
    label: 'Nextcloud',
    detail: 'Clientes/2026/peticao.docx',
    icon: 'cloud',
  });
  assert.equal(describeOrigin({ kind: 'petition', petitionId: 'p1' }).label, 'Jurius');
  assert.equal(describeOrigin({ kind: 'new' }).icon, 'local');
  assert.equal(
    describeOrigin({ kind: 'external', source: { type: 'template-main', templateId: 't' }, fileName: 'm.docx' }).icon,
    'external',
  );
});

test('savedLabelFor descreve o destino gravado', () => {
  assert.equal(savedLabelFor({ action: 'nextcloud', path: 'a.docx', fileName: 'a.docx', etag: null }), 'Salvo no Nextcloud');
  assert.equal(savedLabelFor({ action: 'petition', petitionId: null }), 'Documento salvo com sucesso');
});
