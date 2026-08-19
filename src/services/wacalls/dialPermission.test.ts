import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canDial, isAdminRole, normalizeRole, overrideIsActive,
} from './dialPermission.ts';

const AGORA = Date.parse('2026-08-19T12:00:00Z');

test('o cargo é lido como está escrito no perfil, com acento e maiúscula', () => {
  assert.equal(normalizeRole('Administrador'), 'administrador');
  assert.equal(normalizeRole('  ADMINISTRADOR '), 'administrador');
  assert.equal(normalizeRole('Estagiário'), 'estagiario');
  assert.equal(normalizeRole(null), '');
  assert.ok(isAdminRole('Administrador'));
  assert.ok(!isAdminRole('Advogado'));
});

test('administrador disca mesmo sem linha na tabela de permissões', () => {
  // É o caso real do escritório: o cargo do perfil está gravado com maiúscula
  // e a permissão do módulo pode nem existir para ele.
  assert.ok(canDial({ role: 'Administrador', moduleCanView: false, overrideCanView: false }));
});

test('quem vê o WhatsApp no menu pode ligar pelo WhatsApp', () => {
  assert.ok(canDial({ role: 'Advogado', moduleCanView: true, overrideCanView: false }));
});

test('quem NÃO vê o módulo não disca — nem com can_create ligado', () => {
  // O cargo "auxiliar" está cadastrado hoje com can_view=false e can_create=true.
  // Só `can_view` chega até aqui, e é isso que a regra usa.
  assert.ok(!canDial({ role: 'Auxiliar', moduleCanView: false, overrideCanView: false }));
});

test('cargo sem nenhuma linha na tabela (financeiro) não disca', () => {
  assert.ok(!canDial({ role: 'Financeiro', moduleCanView: false, overrideCanView: false }));
});

test('a concessão individual do admin abre o telefone sem mudar o cargo', () => {
  assert.ok(canDial({ role: 'Auxiliar', moduleCanView: false, overrideCanView: true }));
});

test('concessão sem prazo é permanente; com prazo, vence na hora certa', () => {
  assert.ok(overrideIsActive(null, AGORA));
  assert.ok(overrideIsActive(undefined, AGORA));
  assert.ok(overrideIsActive('2026-08-19T13:00:00Z', AGORA));
  assert.ok(!overrideIsActive('2026-08-19T11:59:59Z', AGORA));
});

test('data de validade ilegível não tira o telefone de ninguém', () => {
  // Perder o direito de ligar por causa de um texto que o banco não soube
  // escrever seria o pior desfecho: a concessão existe, o prazo é que sumiu.
  assert.ok(overrideIsActive('nunca', AGORA));
});
