import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * TODA porta de entrada de um .docx do Nextcloud precisa entrar na SALA.
 * -----------------------------------------------------------------------------
 * Este teste existe por causa de um erro que aconteceu duas vezes.
 *
 * O editor abre um documento do Nextcloud por DOIS caminhos diferentes:
 *
 *   1. `openNextcloudDocument` — "Abrir do Nextcloud" de dentro do editor;
 *   2. `importInitialDocumentFromNextcloud` — o explorador do Nextcloud abrindo
 *      o editor em janela própria (`/editor?...initialNextcloudPath`). Na
 *      prática, o caminho mais usado.
 *
 * Ligar a co-edição só no primeiro deixa o sintoma mais enganoso possível: o
 * serviço no ar, a variável configurada, as pessoas aparecendo como conectadas
 * (pela presença do Supabase) — e nenhuma letra atravessando, porque ninguém
 * chegou a entrar na sala.
 *
 * Se um terceiro caminho de abertura surgir, este teste falha e diz o que fazer.
 */

const moduleSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'PetitionEditorModule.tsx'),
  'utf8',
);

/** Corpo aproximado de uma função declarada como `const nome = useCallback(async (...) => {`. */
function bodyOf(functionName: string): string {
  const start = moduleSource.indexOf(`const ${functionName} = `);
  assert.notEqual(start, -1, `A função ${functionName} não existe mais neste módulo.`);

  // Até a declaração seguinte de mesmo nível (heurística boa o bastante: o
  // arquivo usa `const nome = useCallback(` em coluna 2 para cada função).
  const next = moduleSource.indexOf('\n  const ', start + 10);
  return moduleSource.slice(start, next === -1 ? moduleSource.length : next);
}

const CAMINHOS_QUE_ABREM_DOCUMENTO_DO_NEXTCLOUD = [
  'openNextcloudDocument',
  'importInitialDocumentFromNextcloud',
];

for (const nome of CAMINHOS_QUE_ABREM_DOCUMENTO_DO_NEXTCLOUD) {
  test(`${nome} entra na sala de coedição quando ela está ligada`, () => {
    const body = bodyOf(nome);

    assert.ok(
      body.includes('isCollabEnabled()'),
      `${nome} não consulta isCollabEnabled(): vai abrir o documento sem coedição, ` +
      'mesmo com o serviço no ar.',
    );
    assert.ok(
      body.includes('startCollaboration('),
      `${nome} não chama startCollaboration(): duas pessoas neste documento ficam ` +
      'cada uma com a sua cópia e uma sobrescreve a outra ao salvar.',
    );
  });

  test(`${nome} continua abrindo o documento se a coedição falhar`, () => {
    const body = bodyOf(nome);

    assert.ok(
      body.includes('loadDocxWithFallback('),
      `${nome} não tem caminho de retorno: se o serviço de coedição cair, o usuário ` +
      'fica sem conseguir abrir o documento.',
    );
    assert.ok(
      /catch\s*\(collabError\)/.test(body),
      `${nome} não trata a falha ao entrar na sala — o erro subiria e o documento ` +
      'não abriria de jeito nenhum.',
    );
  });
}

test('nenhum outro ponto do módulo baixa um .docx do Nextcloud por fora desses caminhos', () => {
  // `readFile` do Nextcloud é o que traz o conteúdo do documento. Fora dos
  // caminhos acima (e do recarregamento explícito de versão), qualquer uso novo
  // é um provável caminho de abertura sem sala.
  const ocorrencias = moduleSource.split('nextcloudService.readFile(').length - 1;

  assert.ok(
    ocorrencias <= 4,
    `Apareceram ${ocorrencias} usos de nextcloudService.readFile no módulo. ` +
    'Se for um novo jeito de abrir documento, ele PRECISA entrar na sala de ' +
    'coedição — veja openNextcloudDocument e importInitialDocumentFromNextcloud.',
  );
});
