import assert from 'node:assert/strict';
import test from 'node:test';
import { waAiAnnotateDates, waAiDateBlock, WA_AI_OFFICE_TIME_ZONE } from './wa-ai-now.ts';

test('o bloco traz a data de hoje no fuso do escritório, não em UTC', () => {
  // 12/08/2026 01:00 UTC ainda é dia 11 em Cuiabá (UTC-4). Ler em UTC daria o
  // dia errado — e é justamente o dia que decide se um prazo já venceu.
  const bloco = waAiDateBlock(new Date('2026-08-12T01:00:00Z'));
  assert.match(bloco, /Hoje é terça-feira, 11\/08\/2026\./);
});

test('as datas de referência já vêm calculadas', () => {
  const bloco = waAiDateBlock(new Date('2026-08-12T15:00:00Z'));
  assert.match(bloco, /1 ano atrás: 12\/08\/2025/);
  assert.match(bloco, /2 anos atrás: 12\/08\/2024/);
  assert.match(bloco, /5 anos atrás: 12\/08\/2021/);
});

test('o caso que o agente errou: abril de 2024 está fora da janela de 2 anos', () => {
  // A pessoa saiu em abril/2024 e a triagem seguiu como se estivesse dentro do
  // prazo, porque o modelo não sabia em que ano estava.
  const bloco = waAiDateBlock(new Date('2026-08-12T15:00:00Z'));
  assert.match(bloco, /2 anos atrás: 12\/08\/2024/);
  assert.match(bloco, /data ANTERIOR a essas está a mais tempo do que a janela/);
});

test('29 de fevereiro não vira 1º de março ao voltar um ano', () => {
  const bloco = waAiDateBlock(new Date('2024-02-29T15:00:00Z'));
  assert.match(bloco, /1 ano atrás: 28\/02\/2023/);
  assert.doesNotMatch(bloco, /01\/03\/2023/);
});

test('mês e ano sem dia são tratados como o mês inteiro', () => {
  const bloco = waAiDateBlock(new Date('2026-08-12T15:00:00Z'));
  assert.match(bloco, /use o mês inteiro/);
});

test('o bloco avisa que a data do prompt vence o que o modelo supõe', () => {
  const bloco = waAiDateBlock(new Date('2026-08-12T15:00:00Z'));
  assert.match(bloco, /vale acima de qualquer data que você suponha/);
  assert.match(bloco, /treinamento/i);
});

test('o fuso é o do escritório', () => {
  assert.equal(WA_AI_OFFICE_TIME_ZONE, 'America/Cuiaba');
});

// ── Idade das datas informadas ──────────────────────────────────────────────

const HOJE = new Date('2026-08-12T18:00:00Z');

test('o caso real: saída em janeiro de 2024 chega ao modelo já reprovada', () => {
  // Foi exatamente aqui que a triagem passou duas vezes: o modelo tinha a data
  // de hoje e mesmo assim seguiu perguntando. Agora não sobra conta para ele.
  const saida = waAiAnnotateDates('saida: janeiro de 2024', HOJE);
  assert.match(saida, /há 2 anos e 6 meses/);
  assert.match(saida, /JÁ PASSOU das janelas de 1 e 2 anos/);
});

test('data dentro da janela não recebe reprovação', () => {
  // 2 e não 3: maio sem dia é lido como 31/05, o fim do mês, que é o que conta
  // a favor de quem informou só mês e ano.
  const recente = waAiAnnotateDates('saida: maio de 2026', HOJE);
  assert.match(recente, /há 2 meses/);
  assert.doesNotMatch(recente, /JÁ PASSOU/);
});

test('mês sem dia conta a favor do cliente', () => {
  // "agosto de 2024" com hoje em 12/08/2026: lido como 31/08/2024, ainda não
  // fechou dois anos. Ler como 01/08 descartaria alguém que está no prazo.
  const limite = waAiAnnotateDates('saida: agosto de 2024', HOJE);
  assert.doesNotMatch(limite, /JÁ PASSOU das janelas de 1 e 2/);
  assert.match(limite, /há 1 ano e 11 meses/);
});

test('os três formatos numéricos também são lidos', () => {
  assert.match(waAiAnnotateDates('15/03/2024', HOJE), /há 2 anos/);
  assert.match(waAiAnnotateDates('01/2022', HOJE), /há 4 anos/);
  assert.match(waAiAnnotateDates('2021-06-10', HOJE), /há 5 anos/);
});

test('data futura é marcada, não vira idade negativa', () => {
  assert.match(waAiAnnotateDates('dezembro de 2027', HOJE), /\[data futura\]/);
});

test('o que não é data fica intacto', () => {
  const texto = 'empresa: Todinho 2000; salário: 1500; telefone: 65999998888';
  assert.equal(waAiAnnotateDates(texto, HOJE), texto);
});

test('anotar duas vezes não empilha rótulo', () => {
  const uma = waAiAnnotateDates('saida: janeiro de 2024', HOJE);
  assert.equal(waAiAnnotateDates(uma, HOJE), uma);
});
