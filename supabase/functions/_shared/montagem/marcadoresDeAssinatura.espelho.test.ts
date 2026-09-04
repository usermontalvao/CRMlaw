/**
 * O marcador `[[ASSINATURA]]` vale nos DOIS lados, e tem de ser a MESMA regra.
 *
 * O navegador acha o marcador no DOM (`docxToPdf.ts`) e a Edge Function o acha
 * no XML do `.docx` (`ancoraNoDocx.ts`). Se as duas regras divergirem — uma
 * aceitando `[[ ASSINATURA ]]` com espaço e a outra não, por exemplo — o mesmo
 * documento ganha campo de assinatura por um caminho e não ganha pelo outro,
 * conforme o envelope tenha nascido no assistente ou no `template-fill`.
 *
 * O módulo não tem import nenhum, então a cópia é byte a byte e esta comparação
 * é a rede. Mesma decisão de `selo.ts`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('o espelho em src/utils é idêntico byte a byte', () => {
  const aqui = readFileSync(new URL('./marcadoresDeAssinatura.ts', import.meta.url), 'utf8');
  const la = readFileSync(
    new URL('../../../../src/utils/marcadoresDeAssinatura.ts', import.meta.url), 'utf8');
  assert.equal(aqui, la, 'marcadoresDeAssinatura.ts divergiu — copie o arquivo inteiro');
});
