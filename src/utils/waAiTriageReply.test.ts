import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseWaAiTriageReply } from './waAiTriageReply.ts';

// ── A cópia dupla ───────────────────────────────────────────────────────────

test('wa-ai-triage-reply.ts é cópia byte a byte de waAiTriageReply.ts', () => {
  const src = readFileSync(new URL('./waAiTriageReply.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-triage-reply.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-triage-reply.ts divergiu de waAiTriageReply.ts — copie o arquivo inteiro');
});

const CHAVES = ['nome', 'empregador', 'inicio', 'saida', 'ainda_trabalha'];

// ── O caminho normal ────────────────────────────────────────────────────────

test('a resposta combinada é lida inteira', () => {
  const lida = parseWaAiTriageReply(JSON.stringify({
    mensagem_cliente: 'Certo, Ana! Em que mês e ano você começou?',
    campo_alvo: 'inicio',
    atualizacoes: { nome: 'Ana', empregador: 'Todimo', inicio: '', saida: '', ainda_trabalha: '' },
  }), CHAVES);

  assert.equal(lida.ok, true);
  assert.equal(lida.degraded, false);
  assert.equal(lida.message, 'Certo, Ana! Em que mês e ano você começou?');
  assert.equal(lida.targetField, 'inicio');
  assert.deepEqual(lida.updates, { nome: 'Ana', empregador: 'Todimo' });
});

test('campo vazio não vira dado: é o cliente que ainda não respondeu', () => {
  const lida = parseWaAiTriageReply(JSON.stringify({
    mensagem_cliente: 'Oi!',
    campo_alvo: '',
    atualizacoes: { nome: '   ', inicio: '' },
  }), CHAVES);
  assert.deepEqual(lida.updates, {});
  assert.equal(lida.targetField, null);
});

test('chave fora do roteiro é descartada', () => {
  const lida = parseWaAiTriageReply(JSON.stringify({
    mensagem_cliente: 'Certo.',
    campo_alvo: 'chute',
    atualizacoes: { empresa: 'Todimo', data_inicio: '01/2020', nome: 'Ana' },
  }), CHAVES);
  assert.deepEqual(lida.updates, { nome: 'Ana' });
  assert.equal(lida.targetField, null);
});

test('objeto e lista não viram valor de campo', () => {
  const lida = parseWaAiTriageReply(JSON.stringify({
    mensagem_cliente: 'Certo.',
    atualizacoes: { nome: { primeiro: 'Ana' }, empregador: ['Todimo'], inicio: 12 },
  }), CHAVES);
  assert.deepEqual(lida.updates, { inicio: '12' });
});

// ── A escada da queda ───────────────────────────────────────────────────────

test('degrau 2: JSON dentro da cerca de markdown', () => {
  const lida = parseWaAiTriageReply(
    '```json\n{"mensagem_cliente":"Olá!","campo_alvo":"nome","atualizacoes":{}}\n```', CHAVES);
  assert.equal(lida.message, 'Olá!');
  assert.equal(lida.ok, true);
  assert.equal(lida.degraded, false);
});

test('degrau 2: JSON com prosa em volta é encontrado e marcado', () => {
  const lida = parseWaAiTriageReply(
    'Claro, aqui está:\n{"mensagem_cliente":"Olá!","atualizacoes":{"nome":"Ana"}}\nEspero ter ajudado.',
    CHAVES);
  assert.equal(lida.message, 'Olá!');
  assert.deepEqual(lida.updates, { nome: 'Ana' });
  assert.equal(lida.ok, false);
  assert.equal(lida.degraded, true);
});

test('chave dentro da mensagem não fecha o objeto antes da hora', () => {
  const lida = parseWaAiTriageReply(
    'olha:\n{"mensagem_cliente":"Use a chave } para fechar","atualizacoes":{"nome":"Ana"}}', CHAVES);
  assert.equal(lida.message, 'Use a chave } para fechar');
  assert.deepEqual(lida.updates, { nome: 'Ana' });
});

test('degrau 3: o teto de tokens corta o JSON, a mensagem é resgatada', () => {
  const lida = parseWaAiTriageReply(
    '{"mensagem_cliente":"Entendi, Ana. Você ainda trabalha lá?","campo_alvo":"ainda_trab', CHAVES);
  assert.equal(lida.message, 'Entendi, Ana. Você ainda trabalha lá?');
  assert.equal(lida.degraded, true);
  assert.match(String(lida.reason), /incompleto/);
});

test('degrau 3: aspas escapadas dentro da mensagem sobrevivem', () => {
  const lida = parseWaAiTriageReply(
    '{"mensagem_cliente":"Ela disse \\"sim\\" e saiu","atualiza', CHAVES);
  assert.equal(lida.message, 'Ela disse "sim" e saiu');
});

test('degrau 4: texto puro vira mensagem, e a execução fica marcada', () => {
  const lida = parseWaAiTriageReply('Olá! Qual é o seu nome?', CHAVES);
  assert.equal(lida.message, 'Olá! Qual é o seu nome?');
  assert.equal(lida.ok, false);
  assert.equal(lida.degraded, true);
  assert.deepEqual(lida.updates, {});
});

test('JSON quebrado e sem mensagem não vira mensagem: o cliente não lê chave', () => {
  const lida = parseWaAiTriageReply('{"atualizacoes":{"nome":"Ana"', CHAVES);
  assert.equal(lida.message, '');
  assert.equal(lida.degraded, true);
  assert.match(String(lida.reason), /ilegível/);
});

test('JSON sem mensagem_cliente ainda entrega o que o cliente informou', () => {
  const lida = parseWaAiTriageReply(
    JSON.stringify({ atualizacoes: { nome: 'Ana' }, campo_alvo: 'inicio' }), CHAVES);
  assert.equal(lida.message, '');
  assert.deepEqual(lida.updates, { nome: 'Ana' });
  assert.equal(lida.targetField, 'inicio');
  assert.equal(lida.degraded, true);
});

test('resposta vazia é queda, não mensagem em branco disfarçada', () => {
  const lida = parseWaAiTriageReply('', CHAVES);
  assert.equal(lida.message, '');
  assert.equal(lida.degraded, true);
  assert.match(String(lida.reason), /vazia/);
});

test('objeto embrulhado numa lista é resgatado, mas não passa por resposta boa', () => {
  const lida = parseWaAiTriageReply('[{"mensagem_cliente":"oi","atualizacoes":{"nome":"Ana"}}]', CHAVES);
  assert.equal(lida.message, 'oi');
  assert.deepEqual(lida.updates, { nome: 'Ana' });
  assert.equal(lida.ok, false);
  assert.equal(lida.degraded, true);
});
