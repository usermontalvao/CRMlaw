// A régua de autorização do cofre, escrita como função pura.
//
// Fica separada do resto de propósito: é a regra que decide TUDO (quem vê,
// quem gera código, quem exporta), e é o teste dela que garante que
// administrador não vira dono, que USE não exporta e que sem ACL é 403.
//
// Nada aqui olha para o frontend. A entrada é o que o BANCO disse.

export type VaultPermission = 'USE' | 'MANAGE' | 'EXPORT';

export type VaultRole = 'OWNER' | VaultPermission | 'NONE';

/** Níveis cumulativos. Dono fica acima de tudo. */
const RANK: Record<VaultRole, number> = {
  NONE: 0,
  USE: 1,
  MANAGE: 2,
  EXPORT: 3,
  OWNER: 4,
};

export type VaultAction =
  | 'list'          // aparecer na listagem
  | 'read_metadata' // ver nome, issuer, com quem está compartilhada
  | 'read_code'     // obter o CÓDIGO (não o segredo)
  | 'update'        // renomear, reorganizar
  | 'share'         // conceder/revogar acesso
  | 'export_secret' // ver/exportar o SEGREDO
  | 'transfer'      // trocar o dono
  | 'delete';

export type AclInput = {
  actorUserId: string;
  actorIsActive: boolean;
  /** Administrador do CRM. NÃO concede acesso a segredo — só ao painel. */
  actorIsAdmin: boolean;
  ownerUserId: string;
  /** A permissão gravada em totp_permissions para este ator, se houver. */
  grantedPermission: VaultPermission | null;
  credentialStatus: 'active' | 'archived' | 'deleted';
};

export function resolveRole(input: AclInput): VaultRole {
  if (!input.actorIsActive) return 'NONE';
  if (input.actorUserId && input.actorUserId === input.ownerUserId) return 'OWNER';
  return input.grantedPermission ?? 'NONE';
}

const REQUIRED: Record<VaultAction, VaultRole> = {
  list: 'USE',
  read_metadata: 'USE',
  read_code: 'USE',
  update: 'MANAGE',
  share: 'MANAGE',
  export_secret: 'EXPORT',
  transfer: 'OWNER',
  delete: 'OWNER',
};

export function can(input: AclInput, action: VaultAction): boolean {
  if (!input.actorIsActive) return false;

  // Credencial apagada não é usável por ninguém — nem pelo dono. Só o fluxo
  // administrativo auditado toca no que já foi para a lixeira.
  if (input.credentialStatus === 'deleted') return false;

  // Arquivada: continua visível e administrável, mas não gera código.
  if (input.credentialStatus === 'archived' && action === 'read_code') return false;

  const role = resolveRole(input);
  return RANK[role] >= RANK[REQUIRED[action]];
}

/**
 * O que o administrador pode fazer SEM break-glass: ver a lista, saber de quem
 * é e com quem está compartilhada, revogar compartilhamento suspeito, derrubar
 * dispositivo. Ler o segredo NÃO está aqui — isso é `POST /admin/recover`, com
 * PIN e auditoria.
 *
 * `transfer_ownership` mora aqui, mas é o poder mais delicado da lista: trocar
 * o dono dá ao novo dono o direito de EXPORTAR o segredo. Por isso a função
 * cobra o MESMO preço do break-glass (PIN + step-up + motivo) e recusa
 * transferência para o próprio administrador — ver `adminMayReceiveOwnership`.
 */
export type AdminAction =
  | 'list_all'
  | 'read_metadata'
  | 'revoke_share'
  | 'read_audit'
  | 'archive'
  | 'list_sessions'
  | 'revoke_session'
  | 'transfer_ownership';

const ADMIN_ACTIONS: ReadonlySet<AdminAction> = new Set<AdminAction>([
  'list_all',
  'read_metadata',
  'revoke_share',
  'read_audit',
  'archive',
  'list_sessions',
  'revoke_session',
  'transfer_ownership',
]);

export function adminCan(actorIsActive: boolean, actorIsAdmin: boolean, action: AdminAction): boolean {
  if (!actorIsActive || !actorIsAdmin) return false;
  // Enumerado de propósito: acrescentar um poder novo ao administrador exige
  // mexer aqui, e o teste de "admin não recebe segredo" continua valendo.
  return ADMIN_ACTIONS.has(action);
}

/**
 * O atalho tentador, fechado por regra pura.
 *
 * Sem isto, um administrador transferiria uma chave qualquer para si mesmo e,
 * já como DONO (posto que fica acima de EXPORT), exportaria o segredo sem
 * passar pelo break-glass. A transferência administrativa serve para devolver
 * uma chave órfã a outra pessoa — nunca para o administrador se servir.
 */
export function adminMayReceiveOwnership(actorUserId: string, newOwnerUserId: string): boolean {
  return Boolean(newOwnerUserId) && actorUserId !== newOwnerUserId;
}

/** Quem pode conceder qual nível. Ninguém concede acima do que tem. */
export function canGrant(input: AclInput, target: VaultPermission): boolean {
  if (!can(input, 'share')) return false;
  const role = resolveRole(input);
  return RANK[role] >= RANK[target];
}
