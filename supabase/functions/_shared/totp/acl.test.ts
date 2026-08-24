import test from 'node:test';
import assert from 'node:assert/strict';
import { can, canGrant, adminCan, adminMayReceiveOwnership, resolveRole, type AclInput, type VaultAction } from './acl.ts';

const PEDRO = '11111111-1111-1111-1111-111111111111';
const JOAO  = '22222222-2222-2222-2222-222222222222';
const MARIA = '33333333-3333-3333-3333-333333333333';

const base = (over: Partial<AclInput> = {}): AclInput => ({
  actorUserId: JOAO,
  actorIsActive: true,
  actorIsAdmin: false,
  ownerUserId: PEDRO,
  grantedPermission: null,
  credentialStatus: 'active',
  ...over,
});

const TODAS: VaultAction[] = [
  'list', 'read_metadata', 'read_code', 'update', 'share', 'export_secret', 'transfer', 'delete',
];

test('o dono pode tudo na própria chave', () => {
  const dono = base({ actorUserId: PEDRO });
  assert.equal(resolveRole(dono), 'OWNER');
  for (const acao of TODAS) assert.equal(can(dono, acao), true, acao);
});

test('sem ACL não passa nada — este é o 403 do IDOR', () => {
  const estranho = base();
  assert.equal(resolveRole(estranho), 'NONE');
  for (const acao of TODAS) assert.equal(can(estranho, acao), false, acao);
});

test('USE pega o código e nada além disso', () => {
  const use = base({ grantedPermission: 'USE' });
  assert.equal(can(use, 'read_code'), true);
  assert.equal(can(use, 'read_metadata'), true);
  assert.equal(can(use, 'export_secret'), false);
  assert.equal(can(use, 'share'), false);
  assert.equal(can(use, 'update'), false);
  assert.equal(can(use, 'delete'), false);
  assert.equal(can(use, 'transfer'), false);
});

test('MANAGE compartilha e edita, mas não exporta nem apaga', () => {
  const manage = base({ grantedPermission: 'MANAGE' });
  assert.equal(can(manage, 'share'), true);
  assert.equal(can(manage, 'update'), true);
  assert.equal(can(manage, 'read_code'), true);
  assert.equal(can(manage, 'export_secret'), false);
  assert.equal(can(manage, 'delete'), false);
  assert.equal(can(manage, 'transfer'), false);
});

test('EXPORT exporta, mas continua não sendo dono', () => {
  const exportar = base({ grantedPermission: 'EXPORT' });
  assert.equal(can(exportar, 'export_secret'), true);
  assert.equal(can(exportar, 'share'), true);
  assert.equal(can(exportar, 'delete'), false);
  assert.equal(can(exportar, 'transfer'), false);
});

test('ADMINISTRADOR NÃO É DONO — o cargo sozinho não abre chave nenhuma', () => {
  const admin = base({ actorUserId: MARIA, actorIsAdmin: true });
  for (const acao of TODAS) {
    assert.equal(can(admin, acao), false, `admin não deveria poder ${acao} sem ACL`);
  }
  // Nem com o dono ausente, nem com a chave arquivada, nem em nenhum arranjo:
  // o único caminho é o break-glass, que não passa por `can()`.
  assert.equal(can(base({ actorIsAdmin: true, credentialStatus: 'archived' }), 'export_secret'), false);
});

test('o painel administrativo é outra régua, e ela não inclui segredo', () => {
  assert.equal(adminCan(true, true, 'list_all'), true);
  assert.equal(adminCan(true, true, 'revoke_share'), true);
  assert.equal(adminCan(true, true, 'read_audit'), true);
  assert.equal(adminCan(true, false, 'list_all'), false, 'não-admin não abre o painel');
  assert.equal(adminCan(false, true, 'list_all'), false, 'admin desativado não abre o painel');
  // @ts-expect-error — não existe ação administrativa que leia segredo.
  assert.equal(adminCan(true, true, 'export_secret'), false);
});

test('usuário desativado perde tudo na hora, inclusive sendo dono', () => {
  const donoDesligado = base({ actorUserId: PEDRO, actorIsActive: false });
  for (const acao of TODAS) assert.equal(can(donoDesligado, acao), false, acao);
  assert.equal(resolveRole(donoDesligado), 'NONE');
  assert.equal(adminCan(false, true, 'list_all'), false);
});

test('chave apagada não gera código nem para o dono; arquivada só não gera código', () => {
  const apagada = base({ actorUserId: PEDRO, credentialStatus: 'deleted' });
  for (const acao of TODAS) assert.equal(can(apagada, acao), false, acao);

  const arquivada = base({ actorUserId: PEDRO, credentialStatus: 'archived' });
  assert.equal(can(arquivada, 'read_code'), false);
  assert.equal(can(arquivada, 'read_metadata'), true);
  assert.equal(can(arquivada, 'delete'), true);
});

test('ninguém concede acima do que tem', () => {
  const manage = base({ grantedPermission: 'MANAGE' });
  assert.equal(canGrant(manage, 'USE'), true);
  assert.equal(canGrant(manage, 'MANAGE'), true);
  assert.equal(canGrant(manage, 'EXPORT'), false, 'MANAGE não fabrica EXPORT');

  const dono = base({ actorUserId: PEDRO });
  assert.equal(canGrant(dono, 'EXPORT'), true);

  const use = base({ grantedPermission: 'USE' });
  assert.equal(canGrant(use, 'USE'), false, 'USE não compartilha');
});

// ── poderes administrativos acrescentados: sessões e transferência ──────────

test('administrador ativo enxerga e derruba dispositivo, e pode transferir', () => {
  for (const acao of ['list_sessions', 'revoke_session', 'transfer_ownership'] as const) {
    assert.equal(adminCan(true, true, acao), true, acao);
  }
});

test('quem não é administrador não toca em sessão nem em propriedade', () => {
  for (const acao of ['list_sessions', 'revoke_session', 'transfer_ownership'] as const) {
    assert.equal(adminCan(true, false, acao), false, acao);
  }
});

test('administrador DESATIVADO perde todos os poderes, inclusive os novos', () => {
  for (const acao of ['list_all', 'list_sessions', 'revoke_session', 'transfer_ownership'] as const) {
    assert.equal(adminCan(false, true, acao), false, acao);
  }
});

test('o atalho está fechado: administrador não transfere chave para si mesmo', () => {
  // Sem esta recusa, o admin viraria DONO — e dono exporta segredo sem
  // break-glass, que é exatamente o que o cofre existe para impedir.
  assert.equal(adminMayReceiveOwnership('admin-1', 'admin-1'), false);
  assert.equal(adminMayReceiveOwnership('admin-1', 'outra-pessoa'), true);
  assert.equal(adminMayReceiveOwnership('admin-1', ''), false);
});

test('ser dono continua acima de EXPORT — por isso a recusa acima importa', () => {
  const comoDono = {
    actorUserId: 'admin-1',
    actorIsActive: true,
    actorIsAdmin: true,
    ownerUserId: 'admin-1',
    grantedPermission: null,
    credentialStatus: 'active' as const,
  };
  assert.equal(can(comoDono, 'export_secret'), true);
});
