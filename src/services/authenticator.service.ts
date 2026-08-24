/**
 * Cliente do cofre TOTP (Edge Function `totp-vault`).
 *
 * O CRM fala com o cofre com o MESMO JWT da sessão do escritório — não existe
 * segunda base de usuários. E fala só por aqui: as tabelas `totp_*` têm RLS
 * ligada sem policy nenhuma, então a Data API não devolve nada delas nem para
 * administrador. A autorização inteira mora do lado do servidor.
 *
 * O que este arquivo NUNCA faz: guardar segredo, guardar PIN, guardar token de
 * step-up além do uso imediato, ou decidir permissão. Botão escondido não é
 * autorização — quando a tela esconde uma ação, é conforto; o 403 vem do
 * backend de qualquer forma.
 */
import { supabase } from '../config/supabase';

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/totp-vault`;

export type VaultPermission = 'USE' | 'MANAGE' | 'EXPORT';
export type VaultRole = 'OWNER' | VaultPermission | 'NONE';

export interface VaultCredentialSummary {
  id: string;
  name: string;
  issuer: string | null;
  account_label: string | null;
  algorithm: string;
  digits: number;
  period: number;
  status: 'active' | 'archived' | 'deleted';
  owner_user_id: string;
  owner_name: string | null;
  is_owner: boolean;
  role: VaultRole;
  shared: boolean;
  shared_count: number;
  favorite: boolean;
  can_export: boolean;
  can_manage: boolean;
  created_at: string;
}

export interface VaultAdminCredential {
  id: string;
  name: string;
  issuer: string | null;
  account_label: string | null;
  algorithm: string;
  digits: number;
  period: number;
  status: 'active' | 'archived' | 'deleted';
  key_version: number;
  owner_user_id: string;
  owner_name: string | null;
  owner_email: string | null;
  shares: { user_id: string; permission: VaultPermission; name: string | null }[];
  created_at: string;
  updated_at: string;
}

/** Um acesso concedido por quem está usando a tela a uma chave gerenciável. */
export interface VaultShareSummary {
  credential_id: string;
  credential_name: string;
  credential_issuer: string | null;
  owner_user_id: string;
  owner_name: string | null;
  user_id: string;
  name: string | null;
  email: string | null;
  is_active: boolean;
  permission: VaultPermission;
  created_at: string;
}

export interface VaultAuditEvent {
  id: number;
  event_type: string;
  actor_user_id: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  target_name: string | null;
  credential_id: string | null;
  ip: string | null;
  reason: string | null;
  metadata_safe: Record<string, unknown>;
  created_at: string;
}

export interface VaultSecurityMeta {
  /** Do PIN DO SISTEMA (`user_security_pins`) — o cofre não tem PIN próprio. */
  pin_configured: boolean;
  pin_set_at: string | null;
  pin_updated_at: string | null;
  locked_until: string | null;
  failed_attempts: number;
  last_used_at: string | null;
  /** Sempre 'sistema'. Existe para a tela dizer de onde o PIN vem. */
  pin_origem: 'sistema';
  admins_with_pin: number;
  admins_total: number;
  active_key_version: number;
  key_versions: number[];
}

export interface VaultSession {
  id: string;
  kind: 'extension' | 'web';
  device_name: string | null;
  user_agent: string | null;
  ip: string | null;
  created_at: string;
  last_used_at: string;
  revoked_at: string | null;
  is_current: boolean;
}

/** Uma sessão vista pelo painel do administrador — de qualquer pessoa. */
export interface VaultAdminSession {
  id: string;
  user_id: string;
  user_name: string | null;
  user_email: string | null;
  /** Falso aqui é o caso que mais importa: alguém desligado no CRM com sessão de pé. */
  user_is_active: boolean;
  kind: 'extension' | 'web';
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_reason: string | null;
  is_expired: boolean;
  is_current: boolean;
}

export interface VaultCode {
  credential_id: string;
  code: string;
  digits: number;
  period: number;
  expires_in: number;
  valid_until?: string;
}

export class VaultApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'VaultApiError';
  }
}

/**
 * Identificador DESTE navegador.
 *
 * Sem ele, o cofre trata todos os navegadores da mesma pessoa como uma sessão
 * só (`device_id` fixo). Duas consequências ruins: destravar o PIN num lugar
 * destravava em todos, e a lista de dispositivos do painel mostrava uma linha
 * onde havia três.
 *
 * Não é segredo — é um número aleatório para separar navegadores. Por isso pode
 * viver em `localStorage`: não abre nada sozinho, e quem o copiasse ainda
 * precisaria do JWT e do PIN.
 */
const CHAVE_DISPOSITIVO = 'jurius.vault.device';

function idDoDispositivo(): string {
  try {
    const guardado = localStorage.getItem(CHAVE_DISPOSITIVO);
    if (guardado) return guardado;
    const novo = `crm-${crypto.randomUUID()}`;
    localStorage.setItem(CHAVE_DISPOSITIVO, novo);
    return novo;
  } catch {
    // Navegador com armazenamento bloqueado: volta ao comportamento antigo,
    // que funciona — só não distingue um navegador do outro.
    return 'crm-web';
  }
}

async function chamar<T>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new VaultApiError(401, 'Sua sessão do CRM expirou. Entre novamente.');

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE}${caminho}`, {
      method: init.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Vault-Device': idDoDispositivo(),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    throw new VaultApiError(0, 'Não foi possível falar com o cofre. Verifique a conexão.');
  }

  let payload: any = null;
  try {
    payload = await resposta.json();
  } catch {
    payload = null;
  }

  if (!resposta.ok) {
    throw new VaultApiError(resposta.status, payload?.error ?? 'Não foi possível concluir a operação.');
  }
  return payload as T;
}

class AuthenticatorService {
  // ── o cofre de quem está usando ───────────────────────────────────────────

  listMine() {
    return chamar<{ credentials: VaultCredentialSummary[] }>('/credentials');
  }

  codes(credentialIds?: string[]) {
    return chamar<{ codes: { credential_id: string; code?: string; digits?: number; period?: number; expires_in?: number; error?: string }[]; server_time: number }>(
      '/codes',
      { method: 'POST', body: credentialIds ? { credential_ids: credentialIds } : {} },
    );
  }

  create(dados: {
    name: string; issuer?: string | null; account_label?: string | null; secret: string;
    algorithm?: string; digits?: number; period?: number; owner_user_id?: string;
  }) {
    return chamar<{ credential: { id: string; name: string } }>('/credentials', { method: 'POST', body: dados });
  }

  update(id: string, dados: { name?: string; issuer?: string | null; account_label?: string | null; status?: 'active' | 'archived' }) {
    return chamar<{ ok: true }>(`/credentials/${id}`, { method: 'PATCH', body: dados });
  }

  remove(id: string, motivo: string) {
    return chamar<{ ok: true }>(`/credentials/${id}`, { method: 'DELETE', body: { reason: motivo } });
  }

  permissions(id: string) {
    return chamar<{
      owner: { user_id: string; name: string | null; email: string | null; permission: 'OWNER' };
      permissions: { user_id: string; name: string | null; email: string | null; is_active: boolean; permission: VaultPermission; created_at: string }[];
    }>(`/credentials/${id}/permissions`);
  }

  share(id: string, userId: string, permission: VaultPermission, stepUpToken?: string) {
    return chamar<{ ok: true }>(`/credentials/${id}/permissions`, {
      method: 'POST',
      body: { user_id: userId, permission, step_up_token: stepUpToken },
    });
  }

  revokeShare(id: string, userId: string) {
    return chamar<{ ok: true }>(`/credentials/${id}/permissions/${userId}`, { method: 'DELETE' });
  }

  /** Compartilhamentos das chaves que a pessoa pode gerenciar (sem segredos). */
  listShares() {
    return chamar<{ shares: VaultShareSummary[] }>('/shares');
  }

  transfer(id: string, novoDono: string, stepUpToken: string, motivo?: string) {
    return chamar<{ ok: true }>(`/credentials/${id}/transfer`, {
      method: 'POST',
      body: { new_owner_user_id: novoDono, step_up_token: stepUpToken, reason: motivo },
    });
  }

  exportSecret(id: string, motivo: string, stepUpToken: string) {
    return chamar<{ secret: string; uri: string; name: string }>(`/credentials/${id}/export`, {
      method: 'POST',
      body: { reason: motivo, step_up_token: stepUpToken },
    });
  }

  analyzeImport(payload: string) {
    return chamar<{
      items: { index: number; name: string; issuer: string | null; account_label: string | null; algorithm: string; digits: number; period: number; duplicate: { credential_id: string; name: string } | null }[];
      skipped: { name: string; reason: string }[];
    }>('/import', { method: 'POST', body: { mode: 'analyze', payload } });
  }

  commitImport(payload: string, selected: number[], ownerUserId?: string) {
    return chamar<{ created: { id: string; name: string }[]; skipped: { name: string; reason: string }[] }>(
      '/import',
      { method: 'POST', body: { mode: 'commit', payload, selected, owner_user_id: ownerUserId } },
    );
  }

  // ── identidade ────────────────────────────────────────────────────────────

  me() {
    return chamar<{ user: { id: string; name: string; email: string; role: string; is_admin: boolean }; session: { id: string | null; kind: string }; admin_pin_configured: boolean }>('/auth/me');
  }

  /**
   * Step-up: reautenticação recente. O token vale 5 minutos, é de uso único e
   * fica amarrado à sessão — não é "lembrar que digitei a senha".
   */
  stepUp(senha: string) {
    return chamar<{ step_up_token: string; expires_in: number }>('/auth/step-up', {
      method: 'POST',
      body: { password: senha },
    });
  }

  sessions() {
    return chamar<{ sessions: VaultSession[] }>('/auth/sessions');
  }

  revokeSession(id: string) {
    return chamar<{ ok: true }>(`/auth/sessions/${id}`, { method: 'DELETE' });
  }

  searchUsers(termo: string) {
    return chamar<{ users: { user_id: string; name: string; email: string; role: string; avatar_url: string | null }[] }>(
      `/users/search?q=${encodeURIComponent(termo)}`,
    );
  }

  // ── atalho do CRM (barra do topo) ─────────────────────────────────────────
  //
  // Os códigos aqui exigem um destravamento por PIN válido (2 horas), e a
  // exigência é do SERVIDOR: `/codes` recusa uma sessão web não destravada,
  // mesmo quando a chamada é feita pelo DevTools.

  /**
   * Confere o PIN e destrava os códigos por 2 horas.
   *
   * O destravamento é propriedade da SESSÃO, não um token que a aba carrega —
   * por isso sobrevive a um F5 e vale nas abas daquele navegador.
   */
  unlock(pin: string) {
    return chamar<{ expires_in: number; expires_at: string }>('/auth/unlock', {
      method: 'POST',
      body: { pin },
    });
  }

  /** Ainda destravado? Usado ao abrir o painel, para não pedir PIN à toa. */
  unlockStatus() {
    return chamar<{ unlocked: boolean; expires_at: string | null }>('/auth/unlock');
  }

  /** Trancar agora, sem esperar as 2 horas — o botão "Trancar" do painel. */
  lock() {
    return chamar<{ ok: true }>('/auth/lock', { method: 'POST' });
  }

  // ── administração ─────────────────────────────────────────────────────────

  adminCredentials(opcoes: { q?: string; includeDeleted?: boolean } = {}) {
    const params = new URLSearchParams();
    if (opcoes.q) params.set('q', opcoes.q);
    if (opcoes.includeDeleted) params.set('include_deleted', '1');
    const query = params.toString();
    return chamar<{ credentials: VaultAdminCredential[]; active_key_version: number }>(
      `/admin/credentials${query ? `?${query}` : ''}`,
    );
  }

  adminAudit(opcoes: { limit?: number; eventType?: string; credentialId?: string } = {}) {
    const params = new URLSearchParams();
    params.set('limit', String(opcoes.limit ?? 150));
    if (opcoes.eventType) params.set('event_type', opcoes.eventType);
    if (opcoes.credentialId) params.set('credential_id', opcoes.credentialId);
    return chamar<{ events: VaultAuditEvent[] }>(`/admin/audit?${params.toString()}`);
  }

  adminSecurity() {
    return chamar<VaultSecurityMeta>('/admin/security');
  }

  /** Break-glass. Devolve o segredo UMA vez e registra tudo na auditoria. */
  adminRecover(credentialId: string, pin: string, motivo: string, stepUpToken: string) {
    return chamar<{ secret: string; uri: string; name: string; owner_user_id: string; display_seconds: number }>(
      '/admin/recover',
      { method: 'POST', body: { credential_id: credentialId, pin, reason: motivo, step_up_token: stepUpToken } },
    );
  }

  adminSessions(opcoes: { q?: string; includeRevoked?: boolean } = {}) {
    const params = new URLSearchParams();
    if (opcoes.q) params.set('q', opcoes.q);
    if (opcoes.includeRevoked) params.set('include_revoked', '1');
    const query = params.toString();
    return chamar<{ sessions: VaultAdminSession[] }>(`/admin/sessions${query ? `?${query}` : ''}`);
  }

  /**
   * Derruba o dispositivo de qualquer pessoa. Usa a MESMA rota que o dono usa
   * para derrubar o próprio: quem separa os dois casos é o servidor, que sabe
   * de quem é a sessão — não um endereço diferente escolhido pela tela.
   */
  adminRevokeSession(sessionId: string) {
    return chamar<{ ok: true }>(`/auth/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  }

  /**
   * Transferência administrativa: cobra PIN, step-up e motivo, e o servidor
   * RECUSA transferir para o próprio administrador — virar dono daria direito
   * de exportar o segredo sem passar pelo break-glass.
   */
  adminTransfer(credentialId: string, novoDonoUserId: string, pin: string, motivo: string, stepUpToken: string) {
    return chamar<{ ok: true }>('/admin/transfer', {
      method: 'POST',
      body: {
        credential_id: credentialId,
        new_owner_user_id: novoDonoUserId,
        pin,
        reason: motivo,
        step_up_token: stepUpToken,
      },
    });
  }

  adminRewrap(stepUpToken: string, batch = 50) {
    return chamar<{ rewrapped: number; remaining: number; target_version: number }>('/admin/rewrap', {
      method: 'POST',
      body: { step_up_token: stepUpToken, batch },
    });
  }
}

export const authenticatorService = new AuthenticatorService();

/** Rótulos dos eventos de auditoria, em português de gente. */
export const AUDIT_LABELS: Record<string, string> = {
  LOGIN: 'Entrou na extensão',
  LOGIN_FAILED: 'Tentativa de login falhou',
  LOGOUT: 'Saiu da extensão',
  SESSION_REVOKED: 'Sessão revogada',
  STEP_UP_COMPLETED: 'Confirmou a identidade',
  STEP_UP_FAILED: 'Falhou ao confirmar a identidade',
  CREDENTIAL_CREATED: 'Chave cadastrada',
  CREDENTIAL_UPDATED: 'Chave alterada',
  CREDENTIAL_DELETED: 'Chave excluída',
  CREDENTIAL_TRANSFERRED: 'Propriedade transferida',
  ACCESS_GRANTED: 'Acesso concedido',
  ACCESS_REVOKED: 'Acesso revogado',
  ACCESS_DENIED: 'Acesso negado',
  CODE_ACCESSED: 'Código utilizado',
  EXPORT_REQUESTED: 'Exportação solicitada',
  EXPORT_COMPLETED: 'Segredo exportado',
  IMPORT_COMPLETED: 'Importação concluída',
  ADMIN_VAULT_LISTED: 'Cofre consultado pelo admin',
  ADMIN_PIN_CREATED: 'PIN administrativo criado',
  ADMIN_PIN_CHANGED: 'PIN administrativo alterado',
  ADMIN_PIN_CHANGE_FAILED: 'Falha ao alterar o PIN',
  ADMIN_RECOVERY_REQUESTED: 'Recuperação solicitada',
  ADMIN_RECOVERY_COMPLETED: 'Recuperação concluída',
  ADMIN_RECOVERY_FAILED: 'Recuperação recusada',
  ADMIN_SESSIONS_LISTED: 'Dispositivos consultados pelo admin',
  ADMIN_TRANSFER_REQUESTED: 'Transferência administrativa solicitada',
  ADMIN_TRANSFER_COMPLETED: 'Transferência administrativa concluída',
  ADMIN_TRANSFER_FAILED: 'Transferência administrativa recusada',
  KEY_ROTATION_BATCH: 'Rotação de chave mestra',
};

/** Eventos que merecem destaque visual — são os que auditor procura primeiro. */
export const AUDIT_CRITICAL = new Set([
  'EXPORT_COMPLETED',
  'ADMIN_RECOVERY_COMPLETED',
  'ADMIN_RECOVERY_FAILED',
  'ADMIN_TRANSFER_COMPLETED',
  'ADMIN_TRANSFER_FAILED',
  'ACCESS_DENIED',
  'LOGIN_FAILED',
  'STEP_UP_FAILED',
  'ADMIN_PIN_CHANGE_FAILED',
]);
