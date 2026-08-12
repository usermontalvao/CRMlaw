import assert from 'node:assert/strict';
import test from 'node:test';
import { WA_AI_DIALOGUE_QUALITY_RULES } from './wa-ai-dialogue.ts';

test('as regras impedem que respostas parciais sejam tratadas como completas', () => {
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /respostas parciais/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /pergunte apenas a parte ausente/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /mês e ano de início e de fim/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /valor e periodicidade/i);
});

test('a pergunta única é cobrada da rodada inteira, não de cada mensagem', () => {
  // A redação antiga era "uma pergunta principal por mensagem". Como a resposta
  // é fatiada em bolhas antes de sair, isso permitia mandar duas perguntas em
  // duas mensagens e ficar formalmente correto. O teste fixa o alvo na rodada.
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /UMA pergunta por rodada/);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /espere a resposta antes de fazer a próxima/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /só uma delas pode conter pergunta/i);
  assert.doesNotMatch(WA_AI_DIALOGUE_QUALITY_RULES, /uma pergunta principal por mensagem/i);
});

test('uma resposta só pode encerrar mais de uma pendência', () => {
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /resolver mais de uma pendência/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /que você ainda nem chegou a fazer/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /não autoriza perguntar os dois de uma vez/i);
});

test('as regras mandam separar a resposta em blocos entregáveis', () => {
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /linha em branco/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /mensagem separada/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /três blocos/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /nunca separe uma lista/i);
});

test('assunto fora de escopo é levantado antes de transferir', () => {
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /não se transfere em branco/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /o que aconteceu, quando, com quem e o que a pessoa precisa/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /sem começar do zero/i);
});

test('prazo se conta pela data do prompt, e corta a triagem na hora', () => {
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /nunca com a data que você imagina/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /datas de referência/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /não deve receber mais perguntas de triagem/i);
});

test('as regras reduzem repetição e produzem handoff acionável', () => {
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /Nunca peça novamente/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /Não comece toda resposta/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /lacunas ainda existentes/i);
  assert.match(WA_AI_DIALOGUE_QUALITY_RULES, /próximo passo sugerido/i);
});

