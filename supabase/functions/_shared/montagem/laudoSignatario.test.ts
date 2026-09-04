import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROTULOS_MONOESPACADOS,
  TEXTO_DO_SELO_DE_INTEGRIDADE,
  fichaDoSignatario,
  valorVazio,
} from './laudoSignatario.ts';

const base = { nome: 'Ana Souza', assinadoEm: '03/09/2026 09:02:41' };

test('a ficha vai de identidade a circunstância e termina no ato', () => {
  const rotulos = fichaDoSignatario(base).map(([r]) => r);
  assert.deepEqual(rotulos, [
    'Nome', 'Papel', 'Contato', 'CPF',
    'Endereço IP', 'Localização', 'Dispositivo',
    'Autenticação', 'Termos de Uso', 'Assinado em',
  ]);
});

test('"Assinar" não é papel — é rótulo de botão que vazou', () => {
  const papel = (v: string | null) =>
    fichaDoSignatario({ ...base, papel: v }).find(([r]) => r === 'Papel')?.[1];
  assert.equal(papel('Assinar'), 'Signatário');
  assert.equal(papel(null), 'Signatário');
  assert.equal(papel('Contratante'), 'Contratante');
});

test('campo sem valor vira travessão, não "null"', () => {
  const ficha = fichaDoSignatario(base);
  const cpf = ficha.find(([r]) => r === 'CPF')?.[1];
  assert.equal(cpf, '—');
});

test('sem autenticação declarada, a ficha diz "Assinatura direta"', () => {
  // Nunca um campo vazio: no laudo, espaço em branco onde deveria haver método
  // parece erro de geração, e quem lê não sabe se houve autenticação ou não.
  const a = fichaDoSignatario(base).find(([r]) => r === 'Autenticação')?.[1];
  assert.equal(a, 'Assinatura direta');
});

test('valorVazio reconhece os três jeitos de não ter dado', () => {
  assert.equal(valorVazio(''), true);
  assert.equal(valorVazio('   '), true);
  assert.equal(valorVazio('—'), true);
  assert.equal(valorVazio('-'), true);
  assert.equal(valorVazio(null), true);
  assert.equal(valorVazio(undefined), true);
  assert.equal(valorVazio('0'), false, 'zero é um valor');
  assert.equal(valorVazio('Ana'), false);
});

test('os campos conferidos caractere a caractere são monoespaçados', () => {
  // IP, CPF, coordenadas e data são LIDOS, não escaneados: em fonte
  // proporcional, 0 e O ficam quase iguais.
  for (const r of ['CPF', 'Endereço IP', 'Localização', 'Assinado em']) {
    assert.ok(ROTULOS_MONOESPACADOS.has(r), `${r} deveria ser monoespaçado`);
  }
  assert.ok(!ROTULOS_MONOESPACADOS.has('Nome'), 'nome é texto, não código');
  assert.ok(!ROTULOS_MONOESPACADOS.has('Autenticação'));
});

test('o selo de integridade é INSTRUÇÃO, não afirmação de que já foi selado', () => {
  // A selagem acontece segundos depois desta página ser desenhada, e é falha
  // macia. "Confira no leitor" é verdade nos dois casos; "está selado" não.
  const t = TEXTO_DO_SELO_DE_INTEGRIDADE;
  assert.ok(/Para conferir/.test(t), 'tem de instruir a conferência');
  assert.ok(!/est[eá] (arquivo )?(já )?selado/i.test(t), 'não pode afirmar que já está selado');
});

test('o selo cita o amparo legal e NÃO deprecia o próprio certificado', () => {
  // A frase "não é ICP-Brasil" saiu de propósito: num documento que circula ela
  // não informa — deprecia, e convida a parte contrária a tratar o que é válido
  // como se fosse de segunda.
  const t = TEXTO_DO_SELO_DE_INTEGRIDADE;
  assert.ok(t.includes('MP 2.200-2/2001'), 'o amparo legal tem de estar escrito');
  assert.ok(t.includes('STJ'));
  assert.ok(!/ICP[- ]?Brasil/i.test(t), 'não pode se comparar desfavoravelmente');
});

test('a ficha aceita todos os campos preenchidos sem perder nenhum', () => {
  const ficha = fichaDoSignatario({
    nome: 'Ana', papel: 'Contratante', contato: 'ana@x.com', cpf: '000.000.000-00',
    ip: '200.1.2.3', localizacao: '-15,-56', dispositivo: 'iPhone - Safari',
    autenticacao: 'WhatsApp', termos: 'Aceitos · versão v1', assinadoEm: 'agora',
  });
  assert.equal(ficha.length, 10);
  assert.ok(ficha.every(([, v]) => v && v !== '—'), 'nenhum campo pode sair vazio');
});
