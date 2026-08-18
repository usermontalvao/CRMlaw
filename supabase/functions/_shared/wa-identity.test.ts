import test from 'node:test';
import assert from 'node:assert/strict';
import { ehTelefoneReal, patchIdentidade, stanzaIdCitado } from './wa-identity.ts';

test('telefone real é 55 + DDD + 8/9 dígitos; LID tem mais', () => {
  assert.equal(ehTelefoneReal('556596128787'), true);
  assert.equal(ehTelefoneReal('5565999999999'), true);
  assert.equal(ehTelefoneReal('252677908865131'), false, 'LID de 15 dígitos');
  assert.equal(ehTelefoneReal('30971327959064'), false, 'LID de 14 dígitos');
  assert.equal(ehTelefoneReal(''), false);
  assert.equal(ehTelefoneReal(null), false);
});

test('conversa sem telefone recebe o número real que chegou', () => {
  const patch = patchIdentidade(
    { contact_phone: null, contact_name: null },
    { phone: '556596128787', pushName: 'Lisliandra', fromMe: false },
  );
  assert.equal(patch.contact_phone, '556596128787');
  assert.equal(patch.contact_name, 'Lisliandra');
});

test('conversa que nasceu com LID É PROMOVIDA quando o número aparece', () => {
  const patch = patchIdentidade(
    { contact_phone: '252677908865131', contact_name: null },
    { phone: '556596128787', pushName: null, fromMe: false },
  );
  assert.equal(patch.contact_phone, '556596128787');
});

test('O LID NUNCA SOBRESCREVE UM TELEFONE REAL — nem com o nome vazio', () => {
  // Era exatamente este o caminho do defeito: a guarda antiga (`.or(...)`)
  // deixava passar sempre que `contact_name` estivesse nulo, e os dígitos do
  // apelido interno tomavam o lugar do número da pessoa.
  const patch = patchIdentidade(
    { contact_phone: '556596128787', contact_name: null },
    { phone: '252677908865131', pushName: null, fromMe: false },
  );
  assert.equal(patch.contact_phone, undefined, 'o telefone real tem de ficar onde está');
});

test('nem um LID sobrescreve outro LID inutilmente', () => {
  const patch = patchIdentidade(
    { contact_phone: '252677908865131', contact_name: null },
    { phone: '30971327959064', pushName: null, fromMe: false },
  );
  assert.equal(patch.contact_phone, undefined);
});

test('pushName de mensagem PRÓPRIA não batiza o contato', () => {
  // Em `fromMe` o pushName é o nome do dono da conta conectada — aplicá-lo
  // batizava todo contato novo com o nome do atendente.
  const patch = patchIdentidade(
    { contact_phone: null, contact_name: null },
    { phone: '556596128787', pushName: 'Pedro Montalvão Advocacia', fromMe: true },
  );
  assert.equal(patch.contact_name, undefined);
  assert.equal(patch.contact_phone, '556596128787', 'o telefone continua valendo');
});

test('o nome fica fresco quando já se sabe que é a mesma pessoa', () => {
  const patch = patchIdentidade(
    { contact_phone: '556596128787', contact_name: 'Lis' },
    { phone: '556596128787', pushName: 'Lisliandra Inocêncio', fromMe: false },
  );
  assert.equal(patch.contact_name, 'Lisliandra Inocêncio');
});

test('nome existente NÃO é trocado por quem chegou de outro endereço', () => {
  const patch = patchIdentidade(
    { contact_phone: '556596128787', contact_name: 'Lisliandra' },
    { phone: '252677908865131', pushName: 'Outro Alguém', fromMe: false },
  );
  assert.deepEqual(patch, {});
});

test('a citação denuncia a thread mesmo sem telefone nenhum', () => {
  assert.equal(stanzaIdCitado({ contextInfo: { stanzaId: 'ABC' } }, {}), 'ABC');
  // Em mídia e texto estendido o contextInfo fica DENTRO do nó de conteúdo.
  assert.equal(stanzaIdCitado({}, { imageMessage: { contextInfo: { stanzaId: 'XYZ' } } }), 'XYZ');
  assert.equal(stanzaIdCitado({}, {}), null);
  assert.equal(stanzaIdCitado(null, null), null);
});
