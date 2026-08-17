import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  compareWaAiResidenceHolder,
  isWaAiResidenceProofLabel,
  matchWaAiResidenceHolderToParent,
} from './waAiResidenceHolder.ts';

test('o espelho em supabase/functions/_shared é idêntico byte a byte', () => {
  const src = readFileSync(new URL('./waAiResidenceHolder.ts', import.meta.url), 'utf8');
  const mirror = readFileSync(
    new URL('../../supabase/functions/_shared/wa-ai-residence-holder.ts', import.meta.url), 'utf8');
  assert.equal(mirror, src, 'wa-ai-residence-holder.ts divergiu — copie o arquivo inteiro');
});

// ── Os dois casos reais que motivaram a mudança ─────────────────────────────
//
// Os dois clientes se chamam Igor e os dois são desta campanha. Num deles a
// conta de luz é do próprio; no outro o arquivo se chama, literalmente,
// "COMPROVANTE DE RESIDÊNCIA EM NOME DO PAI". Perguntar antes de ver o
// documento fazia a triagem acreditar na memória da pessoa; agora ela lê.

test('conta de energia no nome do próprio cliente é comprovante dele', () => {
  assert.equal(
    compareWaAiResidenceHolder('IGOR IVAN DA COSTA LEITE', 'IGOR IVAN DA COSTA LEITE'),
    'proprio');
});

test('comprovante em nome do pai é reconhecido como de terceiro', () => {
  // Sobrenome inteiro igual, endereço igual, só o primeiro nome diferente: é
  // exatamente o caso que passa despercebido em conferência apressada.
  assert.equal(
    compareWaAiResidenceHolder('IGOR ALVINO DOS SANTOS', 'JOSE ALVINO DOS SANTOS'),
    'terceiro');
});

test('acento, caixa e pontuação não decidem nada', () => {
  assert.equal(
    compareWaAiResidenceHolder('igor ivan da costa leite', 'IGOR IVAN DA COSTA LEITE.'),
    'proprio');
  assert.equal(
    compareWaAiResidenceHolder('JOÃO DA CONCEIÇÃO', 'JOAO DA CONCEICAO'),
    'proprio');
});

test('abreviação da conta de luz continua sendo a mesma pessoa', () => {
  // "I. I. DA COSTA LEITE" é como a distribuidora costuma imprimir.
  assert.equal(
    compareWaAiResidenceHolder('IGOR IVAN DA COSTA LEITE', 'I I DA COSTA LEITE'),
    'proprio');
});

test('sufixo de geração separa pai e filho', () => {
  assert.equal(compareWaAiResidenceHolder('JOAO SILVA', 'JOAO SILVA FILHO'), 'terceiro');
  assert.equal(compareWaAiResidenceHolder('JOAO SILVA JUNIOR', 'JOAO SILVA'), 'terceiro');
  assert.equal(compareWaAiResidenceHolder('JOAO SILVA NETO', 'JOAO SILVA NETO'), 'proprio');
});

test('nome curto da triagem casa com o nome legal impresso na conta', () => {
  // Na conversa a pessoa digita o nome pelo qual é chamada; a distribuidora
  // imprime o nome inteiro do cadastro. São a MESMA pessoa, e tratar como
  // terceiro faria a IA questionar quem mandou o documento certo.
  assert.equal(
    compareWaAiResidenceHolder('Igor Alvino', 'IGOR ALVINO DOS SANTOS'),
    'proprio');
  assert.equal(
    compareWaAiResidenceHolder('IGOR ALVINO DOS SANTOS', 'Igor Alvino'),
    'proprio');
  // Mas nome curto que NÃO cabe no longo continua sendo outra pessoa.
  assert.equal(
    compareWaAiResidenceHolder('Igor Alvino', 'IGOR IVAN DA COSTA LEITE'),
    'terceiro');
});

test('qualquer um dos nomes conhecidos do cliente serve para conferir', () => {
  // O cadastro tem o nome legal, a triagem tem o que a pessoa digitou. Basta um.
  assert.equal(
    compareWaAiResidenceHolder(['Igor Alvino', 'IGOR ALVINO DOS SANTOS'], 'IGOR ALVINO DOS SANTOS'),
    'proprio');
  assert.equal(
    compareWaAiResidenceHolder(['Pedro Montalvão Advocacia', 'Igor Alvino'], 'IGOR ALVINO DOS SANTOS'),
    'proprio');
  assert.equal(
    compareWaAiResidenceHolder(['Igor Alvino', 'IGOR ALVINO DOS SANTOS'], 'JOSE ALVINO DOS SANTOS'),
    'terceiro');
  assert.equal(compareWaAiResidenceHolder([], 'IGOR ALVINO DOS SANTOS'), 'indefinido');
});

test('esposa com o mesmo sobrenome não passa por titular', () => {
  assert.equal(
    compareWaAiResidenceHolder('CARLOS PEREIRA LIMA', 'MARIA PEREIRA LIMA'),
    'terceiro');
});

test('na dúvida o veredito é indefinido, nunca "é do próprio"', () => {
  // Nome ilegível, cortado ou ausente não pode virar conferência bem-sucedida:
  // aceitar um comprovante de terceiro em silêncio só aparece no protocolo.
  assert.equal(compareWaAiResidenceHolder('IGOR IVAN DA COSTA LEITE', ''), 'indefinido');
  assert.equal(compareWaAiResidenceHolder('IGOR IVAN DA COSTA LEITE', null), 'indefinido');
  assert.equal(compareWaAiResidenceHolder('', 'IGOR IVAN DA COSTA LEITE'), 'indefinido');
  assert.equal(compareWaAiResidenceHolder('IGOR IVAN DA COSTA LEITE', 'IGOR'), 'indefinido');
  assert.equal(compareWaAiResidenceHolder('IGOR', 'IGOR IVAN DA COSTA LEITE'), 'indefinido');
});

test('partículas não contam como sobrenome', () => {
  assert.equal(
    compareWaAiResidenceHolder('ANA DE SOUZA', 'ANA SOUZA'),
    'proprio');
});

// ── Confronto com a filiação do RG ──────────────────────────────────────────

test('a filiação do RG responde sozinha de quem é o comprovante', () => {
  // O caso real: a conta de água está em "JOSE ALVINO DE MATOS" e o RG do
  // cliente traz esse nome como pai. Confrontar os dois evita a pergunta.
  assert.equal(
    matchWaAiResidenceHolderToParent('JOSE ALVINO DE MATOS',
      ['MARIA APARECIDA DOS SANTOS', 'JOSE ALVINO DE MATOS']),
    'JOSE ALVINO DE MATOS');
  assert.equal(
    matchWaAiResidenceHolderToParent('Maria Aparecida dos Santos',
      ['MARIA APARECIDA DOS SANTOS', 'JOSE ALVINO DE MATOS']),
    'MARIA APARECIDA DOS SANTOS');
});

test('titular que não é pai nem mãe deixa a pergunta de pé', () => {
  // Pode ser cônjuge, sogro, locador ou um terceiro qualquer — e nada disso
  // está escrito no RG, então quem responde continua sendo o cliente.
  assert.equal(
    matchWaAiResidenceHolderToParent('CARLA MENDES ROCHA',
      ['MARIA APARECIDA DOS SANTOS', 'JOSE ALVINO DE MATOS']),
    null);
  assert.equal(matchWaAiResidenceHolderToParent('JOSE ALVINO DE MATOS', []), null);
  assert.equal(matchWaAiResidenceHolderToParent('JOSE ALVINO DE MATOS', null), null);
  assert.equal(matchWaAiResidenceHolderToParent('', ['JOSE ALVINO DE MATOS']), null);
  // Filiação ilegível não casa com ninguém.
  assert.equal(matchWaAiResidenceHolderToParent('JOSE ALVINO DE MATOS', ['JOSE', '']), null);
});

// ── Qual item é o comprovante ───────────────────────────────────────────────

test('só o comprovante de residência é conferido pela titularidade', () => {
  assert.equal(isWaAiResidenceProofLabel('Comprovante de residência (conta de luz, água, telefone ou internet)'), true);
  assert.equal(isWaAiResidenceProofLabel('Comprovante de residência em nome de esposa, esposo, pai ou mãe'), true);
  // O contrato de aluguel é do cliente por definição, e o documento do
  // declarante é de outra pessoa por definição: conferir nome nesses dois
  // reabriria uma pergunta que a rota já respondeu.
  assert.equal(isWaAiResidenceProofLabel('Contrato de aluguel'), false);
  assert.equal(isWaAiResidenceProofLabel('Documento de identificação com foto do declarante'), false);
  assert.equal(isWaAiResidenceProofLabel('Documento de identificação com foto do cliente'), false);
  assert.equal(isWaAiResidenceProofLabel('Print, e-mail ou tela mostrando o bloqueio ou encerramento da conta'), false);
  assert.equal(isWaAiResidenceProofLabel(''), false);
  assert.equal(isWaAiResidenceProofLabel(null), false);
});
