import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decidirCampo,
  precisaDaPosicaoDeReserva,
  vaiDesenhar,
  type Decisao,
} from './colocacaoDeAssinatura.ts';

const ANA = 'ana-uuid';
const BRUNO = 'bruno-uuid';

const estado = (p: {
  assinaram?: string[];
  conhecidos?: string[];
  temReserva?: boolean;
}) => ({
  comAssinatura: new Set(p.assinaram ?? []),
  conhecidos: new Set(p.conhecidos ?? []),
  temReserva: p.temReserva ?? true,
});

test('campo de quem já assinou recebe a assinatura dele', () => {
  const d = decidirCampo(ANA, estado({ assinaram: [ANA], conhecidos: [ANA, BRUNO] }));
  assert.deepEqual(d, { tipo: 'assinatura-do-titular', signerId: ANA });
});

test('CAMPO DE QUEM AINDA NÃO ASSINOU FICA VAZIO — nunca recebe a assinatura de outro', () => {
  // O teste mais importante deste arquivo. Sem esta regra, num envelope de dois
  // signatários o primeiro a assinar assinaria pelos dois: o campo do Bruno
  // cairia na reserva e receberia a imagem da Ana. O documento sairia bonito,
  // assinado, atribuindo a manifestação de vontade dele a ela.
  const d = decidirCampo(BRUNO, estado({ assinaram: [ANA], conhecidos: [ANA, BRUNO], temReserva: true }));
  assert.deepEqual(d, { tipo: 'pular-ainda-nao-assinou', signerId: BRUNO });
  assert.equal(vaiDesenhar(d), false, 'não pode desenhar NADA no campo dele');
});

test('a reserva existir não muda nada para quem não assinou', () => {
  // Explicita que o degrau do meio vence a disponibilidade de imagem: ter uma
  // imagem à mão nunca é razão para usá-la no campo errado.
  const comReserva = decidirCampo(BRUNO, estado({ assinaram: [ANA], conhecidos: [ANA, BRUNO], temReserva: true }));
  const semReserva = decidirCampo(BRUNO, estado({ assinaram: [ANA], conhecidos: [ANA, BRUNO], temReserva: false }));
  assert.equal(comReserva.tipo, 'pular-ainda-nao-assinou');
  assert.equal(semReserva.tipo, 'pular-ainda-nao-assinou');
});

test('campo sem dono usa a assinatura de quem está assinando', () => {
  const d = decidirCampo(null, estado({ assinaram: [ANA], conhecidos: [ANA] }));
  assert.deepEqual(d, { tipo: 'assinatura-de-reserva', motivo: 'sem-dono' });
});

test('string vazia conta como sem dono', () => {
  assert.equal(decidirCampo('', estado({})).tipo, 'assinatura-de-reserva');
  assert.equal(decidirCampo(undefined, estado({})).tipo, 'assinatura-de-reserva');
});

test('dono órfão (não está mais no envelope) cai na reserva', () => {
  // Dado inconsistente. A alternativa seria deixar o espaço de assinatura em
  // branco no documento final, o que é pior para quem recebe.
  const d = decidirCampo('fantasma-uuid', estado({ assinaram: [ANA], conhecidos: [ANA] }));
  assert.deepEqual(d, { tipo: 'assinatura-de-reserva', motivo: 'dono-desconhecido' });
});

test('sem imagem nenhuma, nada é desenhado', () => {
  const semDono = decidirCampo(null, estado({ temReserva: false }));
  const orfao = decidirCampo('fantasma', estado({ conhecidos: [ANA], temReserva: false }));
  assert.deepEqual(semDono, { tipo: 'pular-sem-imagem' });
  assert.deepEqual(orfao, { tipo: 'pular-sem-imagem' });
  assert.equal(vaiDesenhar(semDono), false);
});

test('vaiDesenhar separa as quatro decisões corretamente', () => {
  const casos: Array<[Decisao, boolean]> = [
    [{ tipo: 'assinatura-do-titular', signerId: ANA }, true],
    [{ tipo: 'assinatura-de-reserva', motivo: 'sem-dono' }, true],
    [{ tipo: 'pular-ainda-nao-assinou', signerId: BRUNO }, false],
    [{ tipo: 'pular-sem-imagem' }, false],
  ];
  for (const [d, esperado] of casos) {
    assert.equal(vaiDesenhar(d), esperado, `decisão ${d.tipo}`);
  }
});

test('a posição de reserva só entra quando NADA foi desenhado', () => {
  // A correção de um defeito antigo: antes bastava UM campo falhar para a
  // assinatura ser jogada no canto da última página, mesmo com os outros campos
  // corretamente posicionados no documento.
  const umDesenhou: Decisao[] = [
    { tipo: 'assinatura-do-titular', signerId: ANA },
    { tipo: 'pular-ainda-nao-assinou', signerId: BRUNO },
  ];
  assert.equal(precisaDaPosicaoDeReserva(umDesenhou, true), false);

  const nenhumDesenhou: Decisao[] = [
    { tipo: 'pular-ainda-nao-assinou', signerId: BRUNO },
    { tipo: 'pular-sem-imagem' },
  ];
  assert.equal(precisaDaPosicaoDeReserva(nenhumDesenhou, true), true);
});

test('envelope sem campo nenhum cai na posição de reserva', () => {
  assert.equal(precisaDaPosicaoDeReserva([], true), true);
});

test('sem imagem de assinatura não há reserva a desenhar', () => {
  assert.equal(precisaDaPosicaoDeReserva([], false), false);
  assert.equal(precisaDaPosicaoDeReserva([{ tipo: 'pular-sem-imagem' }], false), false);
});

test('envelope de dois signatários: o segundo completa sem mexer no primeiro', () => {
  // O ciclo inteiro, que é o comportamento que o usuário vê.
  const todos = [ANA, BRUNO];

  const naPrimeiraAssinatura = [ANA, BRUNO].map((dono) =>
    decidirCampo(dono, estado({ assinaram: [ANA], conhecidos: todos })));
  assert.equal(naPrimeiraAssinatura[0].tipo, 'assinatura-do-titular');
  assert.equal(naPrimeiraAssinatura[1].tipo, 'pular-ainda-nao-assinou');

  const naSegunda = [ANA, BRUNO].map((dono) =>
    decidirCampo(dono, estado({ assinaram: [ANA, BRUNO], conhecidos: todos })));
  assert.deepEqual(naSegunda.map((d) => d.tipo), ['assinatura-do-titular', 'assinatura-do-titular']);
});
