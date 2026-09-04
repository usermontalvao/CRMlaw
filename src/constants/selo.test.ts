/**
 * A impressão digital do certificado tem de ser a MESMA nos dois lados.
 *
 * Ela aparece no carimbo de margem de toda folha do documento assinado. Com a
 * montagem no servidor (ver `docs/assinatura-montagem-no-servidor.md`), quem
 * desenha esse carimbo passa a ser a Edge Function — que não importa de `src/`
 * e por isso tem cópia própria.
 *
 * Um valor de conferência copiado é um valor que um dia diverge, e divergir
 * AQUI significa o documento carimbar um certificado e a página pública citar
 * outro: exatamente a falsificação que a impressão digital existe para
 * detectar. O módulo não tem import nenhum, então a cópia é byte a byte e esta
 * comparação é a rede.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { SELO_IMPRESSAO_DIGITAL, seloImpressaoCurta } from './selo.ts';

test('o espelho em supabase/functions/_shared/montagem é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./selo.ts', import.meta.url), 'utf8');
  const espelho = readFileSync(
    new URL('../../supabase/functions/_shared/montagem/selo.ts', import.meta.url), 'utf8');
  assert.equal(espelho, src, 'selo.ts divergiu — copie o arquivo inteiro');
});

test('a forma curta são os 8 primeiros bytes, sem os dois-pontos', () => {
  const curta = seloImpressaoCurta(4);
  assert.equal(curta, '82961650C260542C');
  assert.equal(curta.length, 16);
  assert.ok(!curta.includes(':'));
  assert.ok(SELO_IMPRESSAO_DIGITAL.replace(/:/g, '').startsWith(curta));
});
