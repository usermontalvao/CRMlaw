/**
 * TODO import de `_shared/` existe do outro lado — a checagem que faltava.
 *
 * Em 14/08/2026 o agente de WhatsApp ficou FORA DO AR por 25 minutos, e nada
 * neste repositório sabia disso:
 *
 *   worker boot error: Uncaught SyntaxError: The requested module
 *   '../_shared/wa-ai-intent.ts' does not provide an export named
 *   'classifyWaAiObjection'
 *
 * O `index.ts` novo subiu; o `_shared/wa-ai-intent.ts` que declarava a função
 * ficou para trás. O runtime só descobre no BOOT, e boot quebrado é 503 em toda
 * requisição — inclusive nas mensagens dos clientes, que somem sem deixar erro
 * na tabela de execuções, porque a função não chega a rodar.
 *
 * Por que nenhuma rede pegou:
 *   - `tsc --noEmit` tem `rootDir: src/`, e não olha `supabase/functions`
 *     (memória tsc-nao-cobre-edge-functions);
 *   - o `npm test` roda os módulos puros, que estão certos cada um por si;
 *   - os testes de espelho comparam `src/utils/x.ts` com `_shared/x.ts`, e os
 *     dois estavam iguais — o que estava velho era o arquivo IMPLANTADO.
 *
 * O que este teste faz é o que o Deno faria: para cada `import` relativo de
 * cada Edge Function, conferir que o arquivo existe e que exporta cada nome
 * pedido. Não substitui o deploy completo — mas garante que o repositório
 * nunca esteja, ele mesmo, num estado que não sobe.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const FUNCTIONS_DIR = fileURLToPath(new URL('..', import.meta.url));

/** Todo nome exportado por um módulo, incluindo `export type` e `export {}`. */
function exportedNames(file: string): Set<string> {
  const source = ts.createSourceFile(
    file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause;
      if (clause && ts.isNamedExports(clause)) {
        for (const element of clause.elements) names.add(element.name.getText(source));
      }
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
    if (!modifiers.some(item => item.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        names.add(decl.name.getText(source));
      }
    } else if ((statement as { name?: ts.Node }).name) {
      names.add((statement as unknown as { name: ts.Node }).name.getText(source));
    }
  }
  return names;
}

/** Cada `import ... from './x.ts'` de um arquivo, com os nomes pedidos. */
function relativeImports(file: string): { spec: string; names: string[] }[] {
  const source = ts.createSourceFile(
    file, readFileSync(file, 'utf8'), ts.ScriptTarget.ES2022, true);
  const out: { spec: string; names: string[] }[] = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const spec = statement.moduleSpecifier.text;
    if (!spec.startsWith('.')) continue;
    const bindings = statement.importClause?.namedBindings;
    const names = bindings && ts.isNamedImports(bindings)
      ? bindings.elements.map(el => (el.propertyName ?? el.name).getText(source))
      : [];
    out.push({ spec, names });
  }
  return out;
}

function edgeFunctionEntrypoints(): string[] {
  return readdirSync(FUNCTIONS_DIR)
    .filter(name => name !== '_shared' && !name.startsWith('.'))
    .map(name => join(FUNCTIONS_DIR, name))
    .filter(dir => statSync(dir).isDirectory())
    .map(dir => join(dir, 'index.ts'))
    .filter(existsSync);
}

test('toda Edge Function importa só o que os módulos de _shared exportam', () => {
  const entrypoints = edgeFunctionEntrypoints();
  // Se a varredura não achar nada, o teste passaria à toa — e foi de "passar à
  // toa" que a produção caiu.
  assert.ok(entrypoints.length > 0, 'nenhuma Edge Function encontrada para conferir');

  const faltando: string[] = [];
  const pendentes = [...entrypoints];
  const vistos = new Set<string>();

  while (pendentes.length > 0) {
    const file = pendentes.pop()!;
    if (vistos.has(file)) continue;
    vistos.add(file);

    for (const { spec, names } of relativeImports(file)) {
      const target = normalize(join(dirname(file), spec));
      if (!existsSync(target)) {
        faltando.push(`${file} importa ${spec}, que não existe`);
        continue;
      }
      // O módulo importado também é conferido: uma cadeia quebrada mais fundo
      // derruba o boot do mesmo jeito.
      pendentes.push(target);
      const exported = exportedNames(target);
      for (const name of names) {
        if (!exported.has(name)) faltando.push(`${target} não exporta ${name} (pedido por ${file})`);
      }
    }
  }

  assert.deepEqual(faltando, [], `imports quebrados:\n${faltando.join('\n')}`);
});
