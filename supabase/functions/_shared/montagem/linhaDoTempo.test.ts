import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAXIMO_DE_LINHAS_POR_EVENTO,
  PRIORIDADE,
  alturaDoEvento,
  instanteDosTermos,
  ordenarTrilha,
  sufixoDeContato,
  type EventoDaTrilha,
} from './linhaDoTempo.ts';

const ev = (
  rotulo: string, instante: number, prioridade: number,
): EventoDaTrilha => ({ rotulo, instante, prioridade, quando: '', detalhe: '' });

test('a trilha é ordenada pelo instante', () => {
  const r = ordenarTrilha([ev('C', 300, 0), ev('A', 100, 0), ev('B', 200, 0)]);
  assert.deepEqual(r.map((e) => e.rotulo), ['A', 'B', 'C']);
});

test('NO MESMO SEGUNDO, TERMOS VEM ANTES DE ASSINADO', () => {
  // Aceitar os termos e assinar são dois cliques seguidos: caem no mesmo
  // segundo o tempo todo. Sem o desempate, a ordem viria da inserção no array —
  // e o laudo poderia mostrar "Assinado" antes de "Termos", sugerindo que a
  // pessoa assinou sem aceitar nada.
  const mesmoInstante = 1_700_000_000_000;
  const r = ordenarTrilha([
    ev('Assinado', mesmoInstante, PRIORIDADE.assinado),
    ev('Termos', mesmoInstante, PRIORIDADE.termos),
  ]);
  assert.deepEqual(r.map((e) => e.rotulo), ['Termos', 'Assinado']);
});

test('a ordem lógica completa se sustenta num empate geral', () => {
  const t = 1_700_000_000_000;
  const r = ordenarTrilha([
    ev('Assinado', t, PRIORIDADE.assinado),
    ev('Localização', t, PRIORIDADE.localizacao),
    ev('Criado', t, PRIORIDADE.criado),
    ev('Termos', t, PRIORIDADE.termos),
    ev('Biometria facial', t, PRIORIDADE.biometria),
    ev('Visualizado', t, PRIORIDADE.visualizado),
    ev('Autenticação', t, PRIORIDADE.autenticacao),
  ]);
  assert.deepEqual(r.map((e) => e.rotulo), [
    'Criado', 'Visualizado', 'Autenticação', 'Biometria facial',
    'Localização', 'Termos', 'Assinado',
  ]);
});

test('a biometria entra entre autenticação e localização', () => {
  assert.ok(PRIORIDADE.autenticacao < PRIORIDADE.biometria);
  assert.ok(PRIORIDADE.biometria < PRIORIDADE.localizacao);
});

test('o instante manda mais que a prioridade', () => {
  // Um "Assinado" às 10h vem antes de um "Criado" às 11h: a prioridade só
  // desempata, nunca reordena eventos de instantes diferentes.
  const r = ordenarTrilha([ev('Criado', 200, PRIORIDADE.criado), ev('Assinado', 100, PRIORIDADE.assinado)]);
  assert.deepEqual(r.map((e) => e.rotulo), ['Assinado', 'Criado']);
});

test('ordenar não mexe no array recebido', () => {
  // A trilha é montada em pedaços; ordenar no lugar já surpreendeu quem ainda
  // ia acrescentar eventos.
  const original = [ev('B', 200, 0), ev('A', 100, 0)];
  const copia = [...original];
  ordenarTrilha(original);
  assert.deepEqual(original.map((e) => e.rotulo), copia.map((e) => e.rotulo));
});

test('O ACEITE DOS TERMOS NUNCA APARECE DEPOIS DA ASSINATURA', () => {
  // O relógio do aparelho pode gravar valor igual ou até posterior — fuso,
  // latência, ajuste manual da hora. Um laudo que mostra assinatura antes do
  // aceite é munição para a outra parte.
  const assinado = 1_700_000_010_000;
  assert.equal(instanteDosTermos(assinado + 5000, assinado), assinado, 'depois é puxado para o instante da assinatura');
  assert.equal(instanteDosTermos(assinado, assinado), assinado, 'igual permanece igual');
  assert.equal(instanteDosTermos(assinado - 3000, assinado), assinado - 3000, 'antes é preservado');
});

test('sem assinatura, o instante gravado dos termos vale', () => {
  assert.equal(instanteDosTermos(12345, 0), 12345);
});

test('a trava resiste ao caso completo: termos gravado depois, ordem correta no fim', () => {
  const assinado = 1_700_000_000_000;
  const termos = instanteDosTermos(assinado + 2000, assinado);
  const r = ordenarTrilha([
    ev('Assinado', assinado, PRIORIDADE.assinado),
    ev('Termos', termos, PRIORIDADE.termos),
  ]);
  assert.deepEqual(r.map((e) => e.rotulo), ['Termos', 'Assinado']);
});

test('contato confirmado não é repetido na linha do evento', () => {
  // A frase de autenticação já diz o número; repetir deixa o evento com cara de
  // formulário preenchido duas vezes.
  assert.equal(
    sufixoDeContato({ contato: '+55 65 98404-6375', rotulo: 'WhatsApp', identidadeConfirmada: true }),
    '',
  );
});

test('contato NÃO confirmado aparece, com o rótulo do que ele é', () => {
  assert.equal(
    sufixoDeContato({ contato: 'ana@x.com', rotulo: 'Email', identidadeConfirmada: false }),
    ' (Email: ana@x.com)',
  );
});

test('sem contato, não sobra parêntese vazio', () => {
  assert.equal(sufixoDeContato({ contato: '', rotulo: 'Email', identidadeConfirmada: false }), '');
  assert.equal(sufixoDeContato({ contato: '   ', rotulo: 'Email', identidadeConfirmada: false }), '');
  assert.equal(sufixoDeContato({ contato: null, rotulo: 'Email', identidadeConfirmada: false }), '');
});

test('o cartão do evento cresce com as linhas do detalhe', () => {
  assert.equal(alturaDoEvento(1), 38 + 12);
  assert.equal(alturaDoEvento(5) - alturaDoEvento(1), 4 * 12);
});

test('o teto de linhas impede um evento de encher a página', () => {
  // Um agente de usuário cru passa fácil de dez linhas.
  assert.equal(MAXIMO_DE_LINHAS_POR_EVENTO, 5);
  assert.ok(alturaDoEvento(MAXIMO_DE_LINHAS_POR_EVENTO) < 841.89 / 2, 'um evento não pode ocupar meia página');
});
