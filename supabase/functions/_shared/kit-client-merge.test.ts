import test from 'node:test';
import assert from 'node:assert/strict';
import { camposParaGravar, nomeDoKitAcrescenta } from './kit-client-merge.ts';

test('o kit completa o primeiro nome que o atendimento anotou', () => {
  // O caso de 27/08/2026: o pré-cadastro do WhatsApp chamava-se "Jeniffer" e o
  // kit trouxe o nome inteiro. A ficha continuava "Jeniffer".
  assert.equal(nomeDoKitAcrescenta('Jeniffer', 'JENIFFER APARECIDA ALVES RODRIGUES'), true);
  assert.equal(nomeDoKitAcrescenta('Ana', 'Ana Paula Souza'), true);
});

test('nome diferente não apaga o nome certo', () => {
  assert.equal(nomeDoKitAcrescenta('Ana Paula Souza', 'Ana'), false);
  assert.equal(nomeDoKitAcrescenta('Ana', 'Anastácia Lima'), false, 'prefixo tem de ser palavra inteira');
  assert.equal(nomeDoKitAcrescenta('Maria Silva', 'Joana Silva'), false);
  assert.equal(nomeDoKitAcrescenta('Jeniffer', '  '), false);
});

test('acento e caixa não fazem diferença na comparação', () => {
  assert.equal(nomeDoKitAcrescenta('joao', 'JOÃO PEDRO DA SILVA'), true);
  assert.equal(nomeDoKitAcrescenta('João Pedro', 'joao pedro'), false);
});

test('o que não é nome de gente perde para o kit', () => {
  assert.equal(nomeDoKitAcrescenta('556599248258', 'Jeniffer Aparecida'), true);
});

test('campo vazio continua sendo preenchido pelo kit', () => {
  const saida = camposParaGravar({
    atual: { full_name: 'Jeniffer', cpf_cnpj: null, address_city: '' },
    doKit: { full_name: 'Jeniffer', cpf_cnpj: '08540035170', address_city: 'Cuiabá' },
    promovendo: false,
  });
  assert.deepEqual(saida, { cpf_cnpj: '08540035170', address_city: 'Cuiabá' });
});

test('fora da promoção, o kit NÃO mexe no que já está escrito', () => {
  const saida = camposParaGravar({
    atual: { full_name: 'Jeniffer' },
    doKit: { full_name: 'JENIFFER APARECIDA ALVES RODRIGUES' },
    promovendo: false,
  });
  assert.deepEqual(saida, {}, 'ficha de cliente montada pela equipe não é reescrita por formulário');
});

test('na promoção, o nome do kit corrige a etiqueta do atendimento', () => {
  const saida = camposParaGravar({
    atual: { full_name: 'Jeniffer', phone: '(65) 99924-8258' },
    doKit: { full_name: 'JENIFFER APARECIDA ALVES RODRIGUES', phone: '(65) 3333-0000' },
    promovendo: true,
  });
  assert.deepEqual(saida, { full_name: 'JENIFFER APARECIDA ALVES RODRIGUES' },
    'só o nome; o telefone do atendimento é o que conversa com a pessoa');
});

test('campos ignorados não saem do kit', () => {
  const saida = camposParaGravar({
    atual: { client_type: null, created_by: null },
    doKit: { client_type: 'pessoa_fisica', created_by: 'alguem' },
    promovendo: true,
    ignorar: ['client_type', 'created_by'],
  });
  assert.deepEqual(saida, {});
});
