import test from 'node:test';
import assert from 'node:assert/strict';

import { decidirSeMonta, instanteDaAssinatura } from './donoDoArtefato.ts';

/** Ajuda: um relógio de assinaturas por id. */
const relogio = (mapa: Record<string, string>) => (id: string | null) =>
  instanteDaAssinatura(id ? mapa[id] : null);

const ANA = '2026-09-04T10:00:00.000Z';
const BRUNO = '2026-09-04T10:05:00.000Z';

test('segundo clique do MESMO signatário não redesenha nada', () => {
  // A regra "uma vez só". Redesenhar aqui geraria um segundo arquivo com bytes
  // diferentes e um hash novo por cima da impressão digital do documento real.
  const d = decidirSeMonta({
    donoAtual: 'ana', quemPede: 'ana', assinouEm: relogio({ ana: ANA }),
  });
  assert.deepEqual(d, { montar: false, motivo: 'ja-e-meu' });
});

test('o SEGUNDO signatário monta a sua versão — senão a assinatura dele some', () => {
  // O defeito que este módulo existe para impedir: o envelope fecharia com o
  // arquivo da Ana, e a assinatura do Bruno não estaria em documento nenhum.
  const d = decidirSeMonta({
    donoAtual: 'ana', quemPede: 'bruno', assinouEm: relogio({ ana: ANA, bruno: BRUNO }),
  });
  assert.deepEqual(d, { montar: true, motivo: 'dono-assinou-antes' });
});

test('chegada fora de ordem devolve o que está gravado, sem gerar arquivo órfão', () => {
  // A Ana chega DEPOIS do Bruno (repetição atrasada, aba velha). O banco
  // recusaria a versão dela — montar só encheria o bucket.
  const d = decidirSeMonta({
    donoAtual: 'bruno', quemPede: 'ana', assinouEm: relogio({ ana: ANA, bruno: BRUNO }),
  });
  assert.deepEqual(d, { montar: false, motivo: 'dono-assinou-depois' });
});

test('empate no relógio deixa o que está gravado', () => {
  // Dois instantes iguais não provam que a minha versão é a mais nova. Na
  // dúvida, o documento que já existe fica — e ele já é válido.
  const mesmo = { ana: ANA, bruno: ANA };
  assert.equal(
    decidirSeMonta({ donoAtual: 'ana', quemPede: 'bruno', assinouEm: relogio(mesmo) }).montar,
    false,
  );
});

test('registro sem dono não é sobrescrito', () => {
  // Linha anterior ao modelo per_document. Sem saber de quem é o arquivo, o
  // seguro é não passar por cima: ele foi produzido por uma assinatura real.
  const d = decidirSeMonta({
    donoAtual: null, quemPede: 'ana', assinouEm: relogio({ ana: ANA }),
  });
  assert.deepEqual(d, { montar: false, motivo: 'dono-desconhecido' });
});

test('dono com data ilegível perde para quem tem data', () => {
  // Refazer a mais custa um arquivo no bucket; refazer a menos custa uma
  // assinatura que não aparece no documento. A assimetria é a decisão.
  const d = decidirSeMonta({
    donoAtual: 'ana',
    quemPede: 'bruno',
    assinouEm: relogio({ ana: 'nao-e-data', bruno: BRUNO }),
  });
  assert.equal(d.montar, true);
});

test('instanteDaAssinatura aceita o que o Postgres devolve, e só isso', () => {
  assert.equal(instanteDaAssinatura('2026-09-04T10:00:00.000Z'), Date.parse(ANA));
  // O offset curto (+00) que o Postgres às vezes imprime.
  assert.ok(instanteDaAssinatura('2026-09-04 10:00:00+00') > 0);
  for (const ruim of [null, undefined, '', 'ontem', {}, NaN]) {
    assert.equal(instanteDaAssinatura(ruim), 0, String(ruim));
  }
});

test('a decisão nunca depende da ORDEM do envelope, só de quem assinou quando', () => {
  // `signature_signers.order` é a ordem de CONVITE. Quem assina primeiro pode
  // ser o segundo da lista, e usar a ordem aqui faria a versão mais nova perder
  // para a mais velha em todo envelope assinado fora de ordem.
  const assinouEm = relogio({ primeiro: BRUNO, segundo: ANA });
  assert.equal(
    decidirSeMonta({ donoAtual: 'primeiro', quemPede: 'segundo', assinouEm }).montar,
    false,
    'quem assinou antes não sobrescreve quem assinou depois, mesmo vindo antes na lista',
  );
  assert.equal(
    decidirSeMonta({ donoAtual: 'segundo', quemPede: 'primeiro', assinouEm }).montar,
    true,
  );
});
