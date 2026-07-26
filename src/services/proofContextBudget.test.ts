// Cobertura do orçamento e do portão econômico da revisão contextual.
// Execução: `node --test --import ts-node/esm src/services/proofContextBudget.test.ts`
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContextWindow,
  collectSuspectWords,
  configureProofBudget,
  estimateContextCost,
  evaluateContextGate,
  proofBudgetSnapshot,
  registerProofTokens,
  resetProofBudget,
  CONTEXT_WINDOW_MAX_CHARS,
} from './proofContextBudget.ts';
import { hasHighConfidenceCorrection } from '../components/spelling-suggestions.ts';

const deny = (verdict: ReturnType<typeof evaluateContextGate>) =>
  verdict.allow ? null : verdict.reason;

test('sem palavra suspeita não há chamada — o caso mais comum ao digitar', () => {
  resetProofBudget();
  const verdict = evaluateContextGate({
    sentence: 'O reclamante requer a juntada dos documentos anexos.',
    suspects: [],
  });
  assert.equal(deny(verdict), 'sem-palavra-suspeita');
  assert.equal(proofBudgetSnapshot().callsLastHour, 0);
});

test('palavra suspeita com contexto libera a chamada', () => {
  resetProofBudget();
  const verdict = evaluateContextGate({
    sentence: 'Olá mei amigo, tudo bem?',
    suspects: ['mei'],
  });
  assert.ok(verdict.allow);
  assert.equal(verdict.allow && verdict.focus, 'mei');
  assert.ok(verdict.allow && verdict.context.includes('mei'));
  assert.ok(verdict.allow && verdict.estimatedTokens > 0);
});

test('correção que o dicionário local já resolve não gasta token', () => {
  resetProofBudget();
  // "apartir" está na tabela de alta confiança: a sugestão sai offline.
  assert.equal(
    deny(evaluateContextGate({
      sentence: 'apartir de hoje o réu paga',
      suspects: ['apartir'],
      isResolvedLocally: hasHighConfidenceCorrection,
    })),
    'resolvido-localmente',
  );
});

test('palavra sozinha não tem contexto para desambiguar', () => {
  resetProofBudget();
  assert.equal(
    deny(evaluateContextGate({ sentence: 'Reclamatória', suspects: ['Reclamatória'] })),
    'contexto-curto',
  );
});

test('palavra suspeita que não está na frase é ignorada', () => {
  resetProofBudget();
  assert.equal(
    deny(evaluateContextGate({ sentence: 'O autor comprova o vínculo.', suspects: ['prescricao'] })),
    'sem-palavra-suspeita',
  );
});

test('rajada de digitação esgota o orçamento e a camada cai fora', () => {
  resetProofBudget();
  configureProofBudget({ maxCallsPerMinute: 2 });
  const input = { sentence: 'o reclamante mencionou a prescricão do direito', suspects: ['prescricão'] };

  for (let i = 0; i < 2; i++) {
    const verdict = evaluateContextGate(input);
    assert.ok(verdict.allow, `chamada ${i + 1} deveria caber no orçamento`);
    if (verdict.allow) registerProofTokens(verdict.estimatedTokens);
  }
  assert.equal(deny(evaluateContextGate(input)), 'orcamento-esgotado');
  resetProofBudget();
});

test('orçamento por hora considera os tokens, não só a contagem', () => {
  resetProofBudget();
  configureProofBudget({ maxTokensPerHour: 500 });
  registerProofTokens(480);
  assert.equal(
    deny(evaluateContextGate({ sentence: 'o autor pede a rescizão do contrato', suspects: ['rescizão'] })),
    'orcamento-esgotado',
  );
  resetProofBudget();
});

test('a janela deslizante libera as chamadas antigas', () => {
  resetProofBudget();
  configureProofBudget({ maxCallsPerMinute: 1 });
  const now = 1_000_000;
  registerProofTokens(300, now);
  const input = { sentence: 'houve a recizão do contrato de trabalho', suspects: ['recizão'] };

  assert.equal(deny(evaluateContextGate({ ...input, now: now + 30_000 })), 'orcamento-esgotado');
  assert.ok(evaluateContextGate({ ...input, now: now + 61_000 }).allow);
  resetProofBudget();
});

test('a janela de contexto respeita o teto e mantém a palavra dentro', () => {
  const filler = 'considerando os documentos juntados aos autos pela parte ré '.repeat(12);
  const sentence = `${filler} a prescricão do direito de ação ${filler}`;
  const window = buildContextWindow(sentence, 'prescricão');

  assert.ok(window.length <= CONTEXT_WINDOW_MAX_CHARS, `janela de ${window.length} caracteres`);
  assert.ok(window.includes('prescricão'));
  // Sem cortar palavra ao meio nas bordas.
  assert.ok(/^[\p{L}]/u.test(window) && /[\p{L}.,;!?]$/u.test(window));
});

test('frase curta é enviada inteira', () => {
  const sentence = 'Olá mei amigo, tudo bem?';
  assert.equal(buildContextWindow(sentence, 'mei'), sentence);
});

test('custo estimado cresce com o contexto', () => {
  assert.ok(estimateContextCost('a'.repeat(320)) > estimateContextCost('a'.repeat(40)));
});

test('collectSuspectWords consulta cada palavra uma única vez', () => {
  const asked: string[] = [];
  const suspects = collectSuspectWords('O réu réu alegou a prescricão', (word) => {
    asked.push(word);
    return word === 'prescricão';
  });

  assert.deepEqual(suspects, ['prescricão']);
  assert.deepEqual(asked, ['O', 'réu', 'alegou', 'a', 'prescricão']);
});

test('predicado que explode não trava a digitação', () => {
  assert.deepEqual(
    collectSuspectWords('o autor requer', () => { throw new Error('editor sem spellChecker'); }),
    [],
  );
});
