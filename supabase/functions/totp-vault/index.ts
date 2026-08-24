// ============================================================================
// TOTP Vault — a ÚNICA porta do cofre.
//
// Nenhuma tabela `totp_*` é acessível pela Data API (RLS ligada, zero policy).
// Tudo passa por aqui, e aqui a autorização é refeita do zero a cada chamada,
// a partir da identidade da SESSÃO — nunca de um `userId` vindo do corpo.
//
// O princípio que organiza o arquivo:
//
//     AUTENTICAÇÃO  ≠  AUTORIZAÇÃO  ≠  POSSE DO SEGREDO
//
// Login prova quem é. A ACL diz quais chaves. Permissão USE devolve o CÓDIGO,
// jamais o segredo — o segredo só sai por EXPORT com step-up, ou pelo
// break-glass administrativo com PIN, motivo e auditoria.
// ============================================================================

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

import { generateTotp, normalizeAlgorithm, normalizeDigits, normalizePeriod } from '../_shared/totp/totp.ts';
import { base32Decode, isValidBase32, normalizeBase32 } from '../_shared/totp/base32.ts';
import { buildOtpauthUri, parseImportPayload, type ParsedTotpEntry } from '../_shared/totp/otpauth.ts';
import {
  MasterKeyring,
  bytesToPgHex,
  fingerprintSecret,
  openSecret,
  pgHexToBytes,
  randomToken,
  rewrapDek,
  sealSecret,
  sha256Hex,
  type SealedSecret,
} from '../_shared/totp/vault-crypto.ts';
import {
  adminCan,
  adminMayReceiveOwnership,
  can,
  canGrant,
  resolveRole,
  type AclInput,
  type VaultAction,
  type VaultPermission,
  type VaultRole,
} from '../_shared/totp/acl.ts';
import { redact, safeError, safeLog, scrubText } from '../_shared/totp/redact.ts';
import { hitSecurityRateLimit, type SecurityRateLimitRule } from '../_shared/security-rate-limit.ts';

const SCOPE = 'totp-vault';

// ── tempos ──────────────────────────────────────────────────────────────────

// 60 minutos, e não 15, por um motivo de robustez — não de conforto.
//
// Cada vencimento do access força uma rotação do refresh, e cada rotação é uma
// chance de a resposta se perder e a sessão cair. A 15 minutos eram ~96
// rotações por dia; a 60, ~24.
//
// Isso NÃO afrouxa a revogação: toda chamada reconfere a linha da sessão
// (`revoked_at`) e o `is_active` do perfil. Derrubar um dispositivo ou
// desativar alguém continua valendo na chamada seguinte, não no vencimento.
const ACCESS_TTL_SECONDS = 60 * 60;
const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
const STEP_UP_TTL_SECONDS = 5 * 60;
const LAST_USED_THROTTLE_MS = 60_000;
/**
 * Janela em que um refresh token reapresentado é lido como RESPOSTA PERDIDA e
 * não como roubo.
 *
 * O caso benigno é banal: o servidor rotacionou e gravou, e a resposta não
 * chegou (rede, service worker morto, máquina dormindo). A extensão continua
 * com o token antigo, sem culpa nenhuma. Fora desta janela o reuso continua
 * sendo tratado como roubo e derruba a sessão.
 */
const REFRESH_GRACE_MS = 90_000;
const CODE_AUDIT_WINDOW_MINUTES = 15;
const MAX_BODY_BYTES = 512 * 1024;

// ── ambiente ────────────────────────────────────────────────────────────────

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Variável de ambiente ausente: ${name}`);
  return value;
}

function decodeKeyBytes(name: string, raw: string): Uint8Array {
  const trimmed = raw.trim();
  // Aceita base64 e hex — quem gera com `openssl rand -base64 32` e quem gera
  // com `-hex 32` acertam os dois.
  if (/^[0-9a-f]{64}$/i.test(trimmed)) {
    const out = new Uint8Array(32);
    for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(trimmed.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const binary = atob(trimmed.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  if (out.length !== 32) throw new Error(`${name} precisa ter 32 bytes (base64 ou hex)`);
  return out;
}

let _keyring: MasterKeyring | null = null;
function keyring(): MasterKeyring {
  if (_keyring) return _keyring;

  const keys: Record<number, Uint8Array> = {};
  const legacy = Deno.env.get('TOTP_VAULT_MASTER_KEY');
  if (legacy) keys[1] = decodeKeyBytes('TOTP_VAULT_MASTER_KEY', legacy);

  for (const [name, value] of Object.entries(Deno.env.toObject())) {
    const match = /^TOTP_VAULT_MASTER_KEY_V(\d+)$/.exec(name);
    if (match && value) keys[Number(match[1])] = decodeKeyBytes(name, value);
  }

  if (Object.keys(keys).length === 0) {
    throw new Error('Nenhuma chave mestra: configure TOTP_VAULT_MASTER_KEY_V1');
  }

  const active = Deno.env.get('TOTP_VAULT_KEY_VERSION');
  _keyring = new MasterKeyring(keys, active ? Number(active) : undefined);
  return _keyring;
}

let _fingerprintPepper: Uint8Array | null = null;
function fingerprintPepper(): Uint8Array {
  if (!_fingerprintPepper) {
    _fingerprintPepper = decodeKeyBytes(
      'TOTP_VAULT_FINGERPRINT_PEPPER',
      requiredEnv('TOTP_VAULT_FINGERPRINT_PEPPER'),
    );
  }
  return _fingerprintPepper;
}


// ── CORS: allow-list, nunca `*` ─────────────────────────────────────────────

const DEFAULT_ORIGINS = [
  'https://jurius.com.br',
  'https://www.jurius.com.br',
  'http://localhost:5173',
  'http://localhost:3000',
];

function allowedOrigins(): string[] {
  const configured = (Deno.env.get('TOTP_VAULT_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ORIGINS, ...configured])];
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true; // curl, service worker sem origem: a autenticação decide
  return allowedOrigins().includes(origin);
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type, x-vault-session, x-vault-device, x-vault-unlock',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Max-Age': '600',
  };
  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'false';
  }
  return headers;
}

// ── respostas ───────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(readonly status: number, readonly publicMessage: string, readonly internal?: string) {
    super(publicMessage);
  }
}

function json(origin: string | null, payload: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      ...extra,
    },
  });
}

// ── contexto da requisição ──────────────────────────────────────────────────

type Actor = {
  userId: string;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  isAdmin: boolean;
  sessionId: string | null;
  sessionKind: 'extension' | 'web';
};

type Ctx = {
  req: Request;
  db: SupabaseClient;
  origin: string | null;
  ip: string | null;
  userAgent: string | null;
  path: string[];
  method: string;
  url: URL;
  body: Record<string, unknown>;
  actor: Actor | null;
};

function clientIp(req: Request): string | null {
  const raw = req.headers.get('cf-connecting-ip')
    ?? req.headers.get('x-real-ip')
    ?? req.headers.get('x-forwarded-for');
  if (!raw) return null;
  return raw.split(',')[0].trim() || null;
}

function serviceClient(): SupabaseClient {
  return createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Termo de busca dentro de um `or=(...)` do PostgREST.
 *
 * Interpolar o termo cru quebrava a consulta: vírgula, parêntese e ponto são a
 * GRAMÁTICA do filtro, não texto. Aspas duplas fazem o PostgREST tratar o valor
 * como literal; dentro delas só sobra escapar aspa e barra. `%` e `_` também
 * são escapados para não virarem curinga de quem digitou.
 */
/**
 * Dobra acento e caixa para comparar em memória. Serve à busca que NÃO pode
 * virar filtro do PostgREST — a de sessões, cujo nome mora em `profiles`.
 */
function foldForSearch(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function orIlike(columns: string[], term: string): string {
  const escaped = term
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[%_]/g, (match) => `\\${match}`);
  return columns.map((column) => `${column}.ilike."%${escaped}%"`).join(',');
}

// Quem é administrador do cofre. Esta lista tem um par no banco —
// `public.profiles_is_authority()` — e as duas precisam dizer a MESMA coisa.
//
// Por que dá para confiar em `profiles.role` e `profiles.badge`: até a
// migration `profiles_guarda_de_autoridade`, qualquer pessoa podia gravar o
// próprio cargo pela Data API e virar administrador daqui com um UPDATE. Hoje
// um gatilho no banco recusa mudança nessas colunas para quem não é
// autoridade, e o único caminho para alterá-las é server-side (service_role).
// É esse gatilho — não a boa vontade do frontend — que sustenta a linha abaixo.
const ADMIN_ROLES = ['administrador', 'admin', 'socio'];

function normalizeRole(role: string): string {
  return String(role ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

async function loadProfile(db: SupabaseClient, userId: string) {
  const { data, error } = await db
    .from('profiles')
    .select('user_id, name, email, role, badge, is_active')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Não foi possível validar o usuário.', error.message);
  return data;
}

function profileToActor(
  profile: { user_id: string; name: string | null; email: string; role: string; badge: string | null; is_active: boolean },
  sessionId: string | null,
  sessionKind: 'extension' | 'web',
): Actor {
  const role = normalizeRole(profile.role);
  const badge = normalizeRole(profile.badge ?? '');
  return {
    userId: profile.user_id,
    email: profile.email,
    name: profile.name ?? profile.email,
    role: profile.role,
    isActive: profile.is_active === true,
    isAdmin: ADMIN_ROLES.includes(role) || badge === 'administrador',
    sessionId,
    sessionKind,
  };
}

/**
 * Resolve a identidade. Dois caminhos, e só dois:
 *   • extensão → `X-Vault-Session` com token OPACO nosso;
 *   • CRM      → `Authorization: Bearer <JWT do Supabase>`.
 *
 * Nos dois, `profiles.is_active` é conferido AGORA. Desativar alguém no CRM
 * derruba o acesso na chamada seguinte, sem esperar token expirar.
 */
async function resolveActor(ctx: Ctx): Promise<Actor | null> {
  const sessionToken = ctx.req.headers.get('x-vault-session');

  if (sessionToken) {
    const hash = await sha256Hex(sessionToken);
    const { data: session, error } = await ctx.db
      .from('totp_sessions')
      .select('id, user_id, kind, access_expires_at, revoked_at, last_used_at')
      .eq('access_token_hash', hash)
      .maybeSingle();

    if (error) throw new HttpError(500, 'Não foi possível validar a sessão.', error.message);
    if (!session || session.revoked_at) return null;
    if (!session.access_expires_at || new Date(session.access_expires_at).getTime() <= Date.now()) return null;

    const profile = await loadProfile(ctx.db, session.user_id);
    if (!profile) return null;

    if (profile.is_active !== true) {
      // Conta desligada: a sessão morre aqui, não na próxima expiração.
      await ctx.db
        .from('totp_sessions')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user_deactivated' })
        .eq('id', session.id);
      await writeAudit(ctx, {
        event_type: 'SESSION_REVOKED',
        actor_user_id: session.user_id,
        session_id: session.id,
        metadata_safe: { reason: 'user_deactivated' },
      });
      return null;
    }

    const lastUsed = session.last_used_at ? new Date(session.last_used_at).getTime() : 0;
    if (Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
      await ctx.db.from('totp_sessions').update({ last_used_at: new Date().toISOString() }).eq('id', session.id);
    }

    return profileToActor(profile, session.id, 'extension');
  }

  const authHeader = ctx.req.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return null;

  const jwt = authHeader.slice(7).trim();
  const { data: userData, error } = await ctx.db.auth.getUser(jwt);
  if (error || !userData?.user) return null;

  const profile = await loadProfile(ctx.db, userData.user.id);
  if (!profile) return null;

  if (profile.is_active !== true) {
    // Simetria com o caminho da extensão: desligar alguém não deixa uma sessão
    // web de pé esperando o step-up dela vencer.
    await ctx.db
      .from('totp_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user_deactivated' })
      .eq('user_id', profile.user_id)
      .is('revoked_at', null);
    return null;
  }

  const webSessionId = await ensureWebSession(ctx, profile.user_id);
  return profileToActor(profile, webSessionId, 'web');
}

/** A sessão "web" existe só para pendurar o step-up e aparecer na lista. */
async function ensureWebSession(ctx: Ctx, userId: string): Promise<string | null> {
  const deviceId = ctx.req.headers.get('x-vault-device')?.slice(0, 100) || 'crm-web';
  const nowIso = new Date().toISOString();

  const { data: existing } = await ctx.db
    .from('totp_sessions')
    .select('id, last_used_at')
    .eq('user_id', userId)
    .eq('device_id', deviceId)
    .is('revoked_at', null)
    .maybeSingle();

  if (existing) {
    const lastUsed = existing.last_used_at ? new Date(existing.last_used_at).getTime() : 0;
    if (Date.now() - lastUsed > LAST_USED_THROTTLE_MS) {
      await ctx.db.from('totp_sessions').update({ last_used_at: nowIso, ip: ctx.ip, user_agent: ctx.userAgent }).eq('id', existing.id);
    }
    return existing.id;
  }

  const { data: created, error } = await ctx.db
    .from('totp_sessions')
    .insert({
      user_id: userId,
      kind: 'web',
      device_id: deviceId,
      device_name: 'CRM (navegador)',
      user_agent: ctx.userAgent,
      ip: ctx.ip,
      refresh_token_hash: null,
      refresh_expires_at: null,
      last_used_at: nowIso,
    })
    .select('id')
    .maybeSingle();

  if (error) {
    // Duas requisições do CRM chegando juntas disputam o índice único
    // (user_id, device_id). Quem perde a corrida encontra a linha da outra em
    // vez de ficar sem sessão — e sem sessão não há onde guardar o step-up.
    const { data: concorrente } = await ctx.db
      .from('totp_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('device_id', deviceId)
      .is('revoked_at', null)
      .maybeSingle();
    if (concorrente) return concorrente.id;

    safeError(SCOPE, 'não foi possível registrar a sessão web', error);
    return null;
  }
  return created?.id ?? null;
}

function requireActor(ctx: Ctx): Actor {
  if (!ctx.actor) throw new HttpError(401, 'Sessão inválida ou expirada.');
  if (!ctx.actor.isActive) throw new HttpError(403, 'Conta desativada.');
  return ctx.actor;
}

// ── auditoria ───────────────────────────────────────────────────────────────

type AuditEvent = {
  event_type: string;
  actor_user_id?: string | null;
  target_user_id?: string | null;
  credential_id?: string | null;
  session_id?: string | null;
  reason?: string | null;
  metadata_safe?: Record<string, unknown>;
};

/**
 * Higieniza o motivo escrito pelo humano antes de virar linha de auditoria.
 *
 * O campo é texto livre e vai para uma tabela que ninguém pode editar depois.
 * Duas preocupações: caractere de controle (que quebra a leitura do log e
 * permite forjar linha falsa com \n) e a chance de alguém COLAR um segredo ali
 * — o que transformaria a auditoria no vazamento que ela existe para registrar.
 */
function sanitizeReason(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const bruto = String(value);
  const limpo = bruto
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1000);
  if (!limpo) return null;
  // Mesma régua do `metadata_safe`: se o motivo carrega URI otpauth, algo com
  // cara de base32 ou um Bearer, grava-se a marca, não o valor.
  return scrubText(limpo);
}

/**
 * Auditoria FAIL-CLOSED, para as operações em que "aconteceu sem registro" é
 * pior do que "não aconteceu": exportar segredo, break-glass, transferir dono,
 * mexer em ACL.
 *
 * A auditoria comum (`writeAudit`) engole o erro de propósito — um log que
 * falha não deve derrubar um login. Aqui é o contrário: se não deu para
 * registrar, a operação NÃO se completa e o segredo não sai.
 */
async function writeAuditStrict(ctx: Ctx, event: AuditEvent): Promise<void> {
  const { error } = await ctx.db.from('totp_audit_logs').insert({
    event_type: event.event_type,
    actor_user_id: event.actor_user_id ?? ctx.actor?.userId ?? null,
    target_user_id: event.target_user_id ?? null,
    credential_id: event.credential_id ?? null,
    session_id: event.session_id ?? ctx.actor?.sessionId ?? null,
    ip: ctx.ip,
    user_agent: ctx.userAgent?.slice(0, 400) ?? null,
    reason: sanitizeReason(event.reason),
    metadata_safe: redact(event.metadata_safe ?? {}) as Record<string, unknown>,
  });

  if (error) {
    safeError(SCOPE, `auditoria obrigatória falhou em ${event.event_type}`, error);
    throw new HttpError(
      503,
      'A operação foi interrompida: não foi possível registrar a auditoria. Tente de novo.',
      error.message,
    );
  }
}

async function writeAudit(ctx: Ctx, event: AuditEvent): Promise<void> {
  try {
    await ctx.db.from('totp_audit_logs').insert({
      event_type: event.event_type,
      actor_user_id: event.actor_user_id ?? ctx.actor?.userId ?? null,
      target_user_id: event.target_user_id ?? null,
      credential_id: event.credential_id ?? null,
      session_id: event.session_id ?? ctx.actor?.sessionId ?? null,
      ip: ctx.ip,
      user_agent: ctx.userAgent?.slice(0, 400) ?? null,
      reason: sanitizeReason(event.reason),
      // `redact` é o que garante que segredo, PIN ou token jamais cheguem aqui,
      // mesmo que alguém passe um objeto grande sem pensar.
      metadata_safe: redact(event.metadata_safe ?? {}) as Record<string, unknown>,
    });
  } catch (error) {
    // Auditoria que falha não pode derrubar a operação — mas tem de aparecer.
    safeError(SCOPE, `falha ao auditar ${event.event_type}`, error);
  }
}

// ── aviso a quem recebeu ────────────────────────────────────────────────────

/**
 * O cofre fala pelo sino do CRM.
 *
 * Compartilhar era silencioso: a linha entrava na ACL e a pessoa só descobria
 * se resolvesse abrir o painel por conta própria. Acesso que ninguém sabe que
 * tem é acesso que não existe.
 *
 * **Fail-soft de propósito, e a ordem importa.** Isto vai DEPOIS do
 * `writeAuditStrict` — quando o aviso é tentado, o compartilhamento já está
 * gravado e auditado. Derrubar a operação porque o sino não tocou desfaria uma
 * concessão legítima por causa de um efeito colateral. Ver
 * [[cofre-totp-auditoria-fail-closed]]: a regra ali é sobre SEGREDO saindo sem
 * rastro; aqui não sai segredo nenhum.
 *
 * O que trafega: o NOME da chave e quem mexeu. Nunca o segredo, nunca o código
 * — a notificação é um convite a abrir o cofre, não um atalho para dentro dele.
 */
async function notifyUser(
  ctx: Ctx,
  params: {
    userId: string;
    type: 'totp_shared' | 'totp_revoked' | 'totp_transferred';
    title: string;
    message: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  // Ninguém precisa ser avisado do que acabou de fazer.
  if (!params.userId || params.userId === ctx.actor?.userId) return;

  try {
    // INSERT direto, e não o RPC `create_user_notification`: aquele exige
    // `auth.uid()` e aqui só existe a service role, então ele responderia
    // "not authenticated" para SEMPRE — e o fail-soft engoliria o erro,
    // deixando o aviso mudo sem ninguém perceber. É o mesmo caminho que
    // `notification-scheduler` já usa.
    const { error } = await ctx.db.from('user_notifications').insert({
      user_id: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      metadata: redact(params.metadata ?? {}) as Record<string, unknown>,
      read: false,
    });
    if (error) throw error;
  } catch (error) {
    safeError(SCOPE, `falha ao avisar ${params.type}`, error);
  }
}


// ── aviso por e-mail ────────────────────────────────────────────────────────

/**
 * O aviso que sai do CRM.
 *
 * O sino resolve para quem já está com o sistema aberto. Chave 2FA, porém, é
 * quase sempre recebida por quem NÃO está: alguém pede acesso ao painel do
 * banco, do provedor, do tribunal, e precisa saber que já pode entrar. O
 * e-mail é o único aviso que alcança essa pessoa fora do CRM.
 *
 * **Um e-mail por RAJADA, não por chave.** Compartilhar doze chaves de uma vez
 * é uma decisão só — mandar doze e-mails transformaria um aviso útil em spam,
 * e o destinatário leria o último e apagaria o resto sem ler. Por isso quem
 * concede em lote passa por `POST /permissions/bulk`, que conhece a lista
 * inteira e escreve UMA mensagem com todos os nomes.
 *
 * **Nunca vai segredo.** O e-mail carrega o NOME da chave e quem compartilhou.
 * Nem o segredo TOTP nem o código de 6 dígitos passam por aqui — caixa de
 * entrada não é cofre. Ver [[cofre-totp-nao-e-so-permissao]].
 *
 * **Fail-soft, como o sino.** Vem depois da auditoria estrita e do INSERT da
 * permissão; falhar aqui não desfaz um compartilhamento legítimo já gravado.
 */
async function resendSender(ctx: Ctx): Promise<{ key: string; from: string } | null> {
  try {
    const [{ data: notif }, { data: emailCfg }] = await Promise.all([
      ctx.db.from('system_settings').select('value').eq('key', 'notification_config').maybeSingle(),
      ctx.db.from('system_settings').select('value').eq('key', 'email_integration_config').maybeSingle(),
    ]);

    // Mesma ordem do weekly-digest: a chave configurada na tela vence a do
    // ambiente, porque é ela que o escritório troca sem deploy.
    const key = String((notif?.value as any)?.weekly_digest_resend_key ?? '').trim()
      || (Deno.env.get('RESEND_API_KEY') ?? '').trim();
    if (!key) return null;

    const fromName = String((emailCfg?.value as any)?.from_name ?? '').trim();
    const fromEmail = String((emailCfg?.value as any)?.from_email ?? '').trim();
    const from = fromName && fromEmail
      ? `${fromName} <${fromEmail}>`
      : 'Jurius CRM <noreply@jurius.com.br>';

    return { key, from };
  } catch {
    return null;
  }
}

/** Escapa o que vai para dentro do HTML — nome de chave é texto de usuário. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const PERMISSION_LABEL: Record<string, string> = {
  USE: 'gerar os códigos',
  MANAGE: 'gerar os códigos e compartilhar com outras pessoas',
  EXPORT: 'gerar os códigos, compartilhar e exportar a chave',
};

async function emailSharedCredentials(
  ctx: Ctx,
  params: {
    userId: string;
    actorName: string;
    credentialNames: string[];
    permission: VaultPermission;
  },
): Promise<void> {
  if (!params.userId || params.userId === ctx.actor?.userId) return;
  if (params.credentialNames.length === 0) return;

  try {
    const profile = await loadProfile(ctx.db, params.userId);
    const to = (profile?.email ?? '').trim();
    if (!to) return;

    const sender = await resendSender(ctx);
    if (!sender) {
      // Sem Resend configurado o sino continua valendo; só o e-mail não sai.
      safeError(SCOPE, 'e-mail de compartilhamento não enviado', 'Resend não configurado');
      return;
    }

    const varias = params.credentialNames.length > 1;
    const primeiroNome = (profile?.name ?? '').trim().split(/\s+/)[0] || '';
    const assunto = varias
      ? `${params.actorName} compartilhou ${params.credentialNames.length} chaves de acesso com você`
      : `${params.actorName} compartilhou uma chave de acesso com você`;

    const itens = params.credentialNames
      .map((nome) => `<li style="margin:0 0 6px 0;">${escapeHtml(nome)}</li>`)
      .join('');

    const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f8f7f5;padding:24px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e5df;border-radius:12px;padding:24px;">
    <p style="margin:0 0 16px 0;font-size:15px;color:#0f172a;">
      ${primeiroNome ? `Olá, ${escapeHtml(primeiroNome)}.` : 'Olá.'}
    </p>
    <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#334155;">
      <strong>${escapeHtml(params.actorName)}</strong> compartilhou
      ${varias ? `<strong>${params.credentialNames.length} chaves</strong>` : 'uma chave'}
      de autenticação em dois fatores com você no Jurius.
    </p>
    <p style="margin:0 0 8px 0;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8;">
      ${varias ? 'Chaves' : 'Chave'}
    </p>
    <ul style="margin:0 0 18px 0;padding-left:18px;font-size:14px;line-height:1.6;color:#0f172a;">
      ${itens}
    </ul>
    <p style="margin:0 0 18px 0;font-size:14px;line-height:1.6;color:#334155;">
      Com esse acesso você pode ${escapeHtml(PERMISSION_LABEL[params.permission] ?? 'usar a chave')}.
      Abra o <strong>Authenticator</strong> no Jurius (ou a extensão do navegador) para ver os códigos.
    </p>
    <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
      Este e-mail não contém nenhum código nem o segredo das chaves — eles só
      aparecem dentro do cofre. Se você não esperava este acesso, avise a
      administração do escritório.
    </p>
  </div>
</div>`.trim();

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sender.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: sender.from, to: [to], subject: assunto, html }),
    });

    if (!res.ok) {
      safeError(SCOPE, 'falha ao enviar e-mail de compartilhamento', await res.text());
    }
  } catch (error) {
    safeError(SCOPE, 'falha ao enviar e-mail de compartilhamento', error);
  }
}

/** O nome que a pessoa reconhece na lista, sem o segredo junto. */
function credentialLabel(row: { name: string; issuer?: string | null }): string {
  return row.issuer && !row.name.includes(row.issuer) ? `${row.issuer} — ${row.name}` : row.name;
}

/** Quem fez a ação, para o aviso não vir de um fantasma. */
async function actorDisplayName(ctx: Ctx, actor: Actor): Promise<string> {
  try {
    const profile = await loadProfile(ctx.db, actor.userId);
    return profile?.name?.trim() || 'Um administrador';
  } catch {
    return 'Um administrador';
  }
}

// ── rate limit ──────────────────────────────────────────────────────────────

async function enforce(ctx: Ctx, scope: string, rules: SecurityRateLimitRule[]): Promise<void> {
  const outcome = await hitSecurityRateLimit(ctx.db, ctx.req, scope, rules);
  if (outcome.blocked) {
    throw new HttpError(429, `Muitas tentativas. Tente de novo em ${Math.ceil(outcome.retryAfterSeconds / 60)} min.`);
  }
}

// ── acesso a credenciais ────────────────────────────────────────────────────

type CredentialRow = {
  id: string;
  owner_user_id: string;
  name: string;
  issuer: string | null;
  account_label: string | null;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: number;
  period: number;
  secret_ciphertext: string;
  secret_iv: string;
  wrapped_dek: string;
  dek_iv: string;
  key_version: number;
  crypto_version: number;
  secret_fingerprint: string;
  status: 'active' | 'archived' | 'deleted';
  created_at: string;
  updated_at: string;
};

const CREDENTIAL_COLUMNS =
  'id, owner_user_id, name, issuer, account_label, algorithm, digits, period, secret_ciphertext, secret_iv, wrapped_dek, dek_iv, key_version, crypto_version, secret_fingerprint, status, created_at, updated_at';

const METADATA_COLUMNS =
  'id, owner_user_id, name, issuer, account_label, algorithm, digits, period, status, created_at, updated_at';

function sealedFrom(row: CredentialRow): SealedSecret {
  return {
    credentialId: row.id,
    secretCiphertext: pgHexToBytes(row.secret_ciphertext),
    secretIv: pgHexToBytes(row.secret_iv),
    wrappedDek: pgHexToBytes(row.wrapped_dek),
    dekIv: pgHexToBytes(row.dek_iv),
    keyVersion: row.key_version,
    cryptoVersion: row.crypto_version,
  };
}

async function grantedPermission(
  ctx: Ctx,
  credentialId: string,
  userId: string,
): Promise<VaultPermission | null> {
  const { data, error } = await ctx.db
    .from('totp_permissions')
    .select('permission')
    .eq('credential_id', credentialId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Não foi possível verificar a permissão.', error.message);
  return (data?.permission as VaultPermission | undefined) ?? null;
}

async function aclFor(ctx: Ctx, actor: Actor, row: { id: string; owner_user_id: string; status: string }): Promise<AclInput> {
  return {
    actorUserId: actor.userId,
    actorIsActive: actor.isActive,
    actorIsAdmin: actor.isAdmin,
    ownerUserId: row.owner_user_id,
    grantedPermission: actor.userId === row.owner_user_id ? null : await grantedPermission(ctx, row.id, actor.userId),
    credentialStatus: row.status as 'active' | 'archived' | 'deleted',
  };
}

/**
 * Carrega a credencial JÁ autorizada. Todo handler passa por aqui — é o ponto
 * único onde "existe" e "posso" viram a mesma decisão, e por isso o 404 e o
 * 403 são a MESMA resposta: quem não pode não descobre nem que a chave existe.
 */
async function loadAuthorized(
  ctx: Ctx,
  actor: Actor,
  credentialId: string,
  action: VaultAction,
  columns = CREDENTIAL_COLUMNS,
): Promise<{ row: CredentialRow; acl: AclInput; role: VaultRole }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(credentialId)) {
    throw new HttpError(404, 'Credencial não encontrada.');
  }

  const { data, error } = await ctx.db
    .from('totp_credentials')
    .select(columns)
    .eq('id', credentialId)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Não foi possível abrir a credencial.', error.message);
  if (!data) throw new HttpError(404, 'Credencial não encontrada.');

  const row = data as unknown as CredentialRow;
  const acl = await aclFor(ctx, actor, row);

  if (!can(acl, action)) {
    await writeAudit(ctx, {
      event_type: 'ACCESS_DENIED',
      credential_id: row.id,
      target_user_id: row.owner_user_id,
      metadata_safe: { action, role: resolveRole(acl) },
    });
    // Mesma resposta do inexistente: não se enumera cofre alheio.
    throw new HttpError(403, 'Você não tem acesso a esta credencial.');
  }

  return { row, acl, role: resolveRole(acl) };
}

// ── step-up ─────────────────────────────────────────────────────────────────

async function requireStepUp(ctx: Ctx, actor: Actor, token: unknown): Promise<void> {
  const value = typeof token === 'string' ? token.trim() : '';
  if (!value || !actor.sessionId) {
    throw new HttpError(401, 'Confirme sua identidade novamente para continuar.');
  }

  const hash = await sha256Hex(value);
  const { data, error } = await ctx.db
    .from('totp_sessions')
    .select('id, step_up_token_hash, step_up_expires_at, revoked_at')
    .eq('id', actor.sessionId)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Não foi possível validar a confirmação.', error.message);
  if (!data || data.revoked_at || !data.step_up_token_hash || data.step_up_token_hash !== hash) {
    throw new HttpError(401, 'Confirme sua identidade novamente para continuar.');
  }
  if (!data.step_up_expires_at || new Date(data.step_up_expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, 'A confirmação expirou. Refaça a verificação.');
  }
}

/** Step-up é de uso único: gastar aqui impede reaproveitar a mesma confirmação. */
async function consumeStepUp(ctx: Ctx, actor: Actor): Promise<void> {
  if (!actor.sessionId) return;
  await ctx.db
    .from('totp_sessions')
    .update({ step_up_token_hash: null, step_up_expires_at: null })
    .eq('id', actor.sessionId);
}

async function verifyPassword(ctx: Ctx, email: string, password: string): Promise<boolean> {
  const anon = createClient(requiredEnv('SUPABASE_URL'), requiredEnv('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password });
  if (error || !data?.session) return false;

  // A sessão criada só para conferir a senha não deve ficar de pé.
  try {
    await ctx.db.auth.admin.signOut(data.session.access_token, 'local');
  } catch (_) {
    // Melhor esforço: o token expira sozinho em 1h.
  }
  return true;
}

// ============================================================================
// HANDLERS — autenticação
// ============================================================================

async function handleLogin(ctx: Ctx): Promise<Response> {
  const email = String(ctx.body.email ?? '').trim().toLowerCase();
  const password = String(ctx.body.password ?? '');
  const deviceId = String(ctx.body.device_id ?? '').trim().slice(0, 100);
  const deviceName = String(ctx.body.device_name ?? 'Extensão Chrome').trim().slice(0, 120);

  if (!email || !password || !deviceId) {
    throw new HttpError(400, 'Informe e-mail, senha e identificação do dispositivo.');
  }

  await enforce(ctx, 'totp-login', [
    { bucketType: 'ip', limit: 20, windowSeconds: 300, blockSeconds: 900 },
    { bucketType: 'email', value: email, limit: 10, windowSeconds: 300, blockSeconds: 900 },
  ]);

  const ok = await verifyPassword(ctx, email, password);
  if (!ok) {
    await writeAudit(ctx, { event_type: 'LOGIN_FAILED', metadata_safe: { email } });
    throw new HttpError(401, 'E-mail ou senha inválidos.');
  }

  const { data: profile, error } = await ctx.db
    .from('profiles')
    .select('user_id, name, email, role, badge, is_active')
    .ilike('email', email)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Não foi possível concluir o login.', error.message);
  if (!profile) throw new HttpError(403, 'Esta conta não tem acesso ao cofre.');
  if (profile.is_active !== true) {
    await writeAudit(ctx, { event_type: 'LOGIN_FAILED', actor_user_id: profile.user_id, metadata_safe: { reason: 'inactive' } });
    throw new HttpError(403, 'Conta desativada.');
  }

  // O PIN entra AQUI, no login do dispositivo — e só aqui.
  //
  // A escolha é deliberada: senha prova quem é, PIN prova que é a pessoa e não
  // alguém que sentou no computador dela. Depois disso a extensão trabalha em
  // paz, sem pedir PIN a cada código: o dispositivo já foi provado, e cobrar de
  // novo a cada uso transformaria o produto em obstáculo — que é como as
  // pessoas acabam desligando a segurança.
  //
  // O CRM é o contrário: lá o PIN é pedido A CADA abertura do painel, porque o
  // navegador do escritório fica aberto na mesa. Mesma chave, riscos
  // diferentes, travas diferentes.
  const pin = String(ctx.body.pin ?? '');
  if (!pin) {
    await writeAudit(ctx, { event_type: 'LOGIN_FAILED', actor_user_id: profile.user_id, metadata_safe: { reason: 'pin_missing' } });
    throw new HttpError(428, 'Informe também o seu PIN de segurança.');
  }

  const { data: veredito, error: erroPin } = await ctx.db.rpc('totp_verify_security_pin', {
    p_user_id: profile.user_id,
    p_pin: pin,
    p_action: 'totp_vault_login',
  });
  if (erroPin) throw new HttpError(500, 'Não foi possível conferir o PIN.', erroPin.message);

  const rPin = (veredito ?? {}) as { ok?: boolean; error?: string; locked_until?: string; attempts_left?: number };
  if (rPin.ok !== true) {
    await writeAudit(ctx, {
      event_type: 'LOGIN_FAILED',
      actor_user_id: profile.user_id,
      metadata_safe: { reason: `pin_${rPin.error ?? 'invalido'}` },
    });
    if (rPin.error === 'no_pin') {
      throw new HttpError(400, 'Você ainda não tem PIN de segurança. Cadastre no CRM, em Meu Perfil → Segurança.');
    }
    if (rPin.error === 'locked') {
      const restam = rPin.locked_until ? new Date(rPin.locked_until).getTime() - Date.now() : 900_000;
      throw new HttpError(429, `PIN bloqueado. Tente em ${Math.max(1, Math.ceil(restam / 60_000))} min.`);
    }
    throw new HttpError(
      401,
      typeof rPin.attempts_left === 'number'
        ? `PIN incorreto. Restam ${rPin.attempts_left} tentativas.`
        : 'PIN incorreto.',
    );
  }

  // Reautenticar o mesmo dispositivo troca a sessão: o índice único
  // (user_id, device_id) onde revoked_at é nulo garante que só uma fica de pé.
  await ctx.db
    .from('totp_sessions')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: 'reauthenticated' })
    .eq('user_id', profile.user_id)
    .eq('device_id', deviceId)
    .is('revoked_at', null);

  const tokens = await issueTokens(ctx, {
    userId: profile.user_id,
    deviceId,
    deviceName,
    kind: 'extension',
  });

  await writeAudit(ctx, {
    event_type: 'LOGIN',
    actor_user_id: profile.user_id,
    session_id: tokens.sessionId,
    metadata_safe: { device_name: deviceName },
  });

  const actor = profileToActor(profile, tokens.sessionId, 'extension');
  return json(ctx.origin, { ...tokens.payload, user: publicActor(actor) });
}

function publicActor(actor: Actor) {
  return {
    id: actor.userId,
    name: actor.name,
    email: actor.email,
    role: actor.role,
    is_admin: actor.isAdmin,
  };
}

async function issueTokens(
  ctx: Ctx,
  input: { userId: string; deviceId: string; deviceName: string; kind: 'extension' },
): Promise<{ sessionId: string; payload: Record<string, unknown> }> {
  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const now = Date.now();

  const { data, error } = await ctx.db
    .from('totp_sessions')
    .insert({
      user_id: input.userId,
      kind: input.kind,
      device_id: input.deviceId,
      device_name: input.deviceName,
      user_agent: ctx.userAgent,
      ip: ctx.ip,
      access_token_hash: await sha256Hex(accessToken),
      access_expires_at: new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString(),
      refresh_token_hash: await sha256Hex(refreshToken),
      refresh_expires_at: new Date(now + REFRESH_TTL_SECONDS * 1000).toISOString(),
      refresh_generation: 0,
    })
    .select('id')
    .maybeSingle();

  if (error || !data) throw new HttpError(500, 'Não foi possível abrir a sessão.', error?.message);

  return {
    sessionId: data.id,
    payload: {
      access_token: accessToken,
      access_expires_in: ACCESS_TTL_SECONDS,
      refresh_token: refreshToken,
      refresh_expires_in: REFRESH_TTL_SECONDS,
      session_id: data.id,
    },
  };
}

async function handleRefresh(ctx: Ctx): Promise<Response> {
  const presented = String(ctx.body.refresh_token ?? '').trim();
  if (!presented) throw new HttpError(400, 'Sessão inválida.');

  await enforce(ctx, 'totp-refresh', [
    { bucketType: 'ip', limit: 120, windowSeconds: 300, blockSeconds: 600 },
  ]);

  const hash = await sha256Hex(presented);

  // Token já girado sendo reapresentado. Duas leituras possíveis, e confundi-las
  // custava a sessão do usuário: ROUBO (derruba tudo) ou RESPOSTA PERDIDA
  // (reemite). O relógio é que separa as duas.
  const { data: reused } = await ctx.db
    .from('totp_sessions')
    .select('id, user_id, refresh_rotated_at')
    .eq('previous_refresh_hash', hash)
    .is('revoked_at', null)
    .maybeSingle();

  // Quando é resposta perdida, a renovação segue por esta coluna em vez da
  // habitual — o token que o cliente tem em mãos é o anterior.
  let colunaDoToken: 'refresh_token_hash' | 'previous_refresh_hash' = 'refresh_token_hash';

  if (reused) {
    const rotacionadoEm = reused.refresh_rotated_at
      ? new Date(reused.refresh_rotated_at as string).getTime()
      : 0;
    const dentroDaJanela = Date.now() - rotacionadoEm <= REFRESH_GRACE_MS;

    if (dentroDaJanela) {
      colunaDoToken = 'previous_refresh_hash';
      await writeAudit(ctx, {
        event_type: 'REFRESH_REPLAYED',
        actor_user_id: reused.user_id as string,
        session_id: reused.id as string,
        metadata_safe: { reason: 'resposta_perdida', dentro_de_ms: Date.now() - rotacionadoEm },
      });
    } else {
      await ctx.db
        .from('totp_sessions')
        .update({ revoked_at: new Date().toISOString(), revoked_reason: 'refresh_reuse_detected' })
        .eq('id', reused.id);
      await writeAudit(ctx, {
        event_type: 'SESSION_REVOKED',
        actor_user_id: reused.user_id as string,
        session_id: reused.id as string,
        metadata_safe: { reason: 'refresh_reuse_detected', apos_ms: Date.now() - rotacionadoEm },
      });
      throw new HttpError(401, 'Sessão encerrada por segurança. Entre novamente.');
    }
  }

  const { data: session, error } = await ctx.db
    .from('totp_sessions')
    .select('id, user_id, refresh_expires_at, revoked_at, refresh_generation, device_id')
    .eq(colunaDoToken, hash)
    .maybeSingle();

  if (error) throw new HttpError(500, 'Não foi possível renovar a sessão.', error.message);
  if (!session || session.revoked_at) throw new HttpError(401, 'Sessão encerrada. Entre novamente.');
  if (!session.refresh_expires_at || new Date(session.refresh_expires_at).getTime() <= Date.now()) {
    throw new HttpError(401, 'Sessão expirada. Entre novamente.');
  }

  const profile = await loadProfile(ctx.db, session.user_id);
  if (!profile || profile.is_active !== true) {
    await ctx.db
      .from('totp_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'user_deactivated' })
      .eq('id', session.id);
    throw new HttpError(403, 'Conta desativada.');
  }

  const accessToken = randomToken(32);
  const refreshToken = randomToken(32);
  const now = Date.now();

  const { data: rotacionadas, error: rotateError } = await ctx.db
    .from('totp_sessions')
    .update({
      access_token_hash: await sha256Hex(accessToken),
      access_expires_at: new Date(now + ACCESS_TTL_SECONDS * 1000).toISOString(),
      previous_refresh_hash: hash,
      refresh_token_hash: await sha256Hex(refreshToken),
      refresh_expires_at: new Date(now + REFRESH_TTL_SECONDS * 1000).toISOString(),
      refresh_generation: (session.refresh_generation ?? 0) + 1,
      refresh_rotated_at: new Date(now).toISOString(),
      last_used_at: new Date().toISOString(),
      ip: ctx.ip,
    })
    .eq('id', session.id)
    // A condição extra fecha a corrida: dois refresh simultâneos, só um vence.
    // Casa pela MESMA coluna que localizou a sessão — no caminho da resposta
    // perdida, o token em mãos é o anterior.
    .eq(colunaDoToken, hash)
    .is('revoked_at', null)
    // Sem o `select`, o PostgREST devolve sucesso mesmo tendo afetado ZERO
    // linhas — e o perdedor da corrida recebia tokens novos que nunca foram
    // gravados: um par que não abre nada, entregue como se fosse válido.
    .select('id');

  if (rotateError) throw new HttpError(401, 'Sessão encerrada. Entre novamente.');
  if (!rotacionadas || rotacionadas.length !== 1) {
    throw new HttpError(401, 'Sessão encerrada. Entre novamente.');
  }

  return json(ctx.origin, {
    access_token: accessToken,
    access_expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refreshToken,
    refresh_expires_in: REFRESH_TTL_SECONDS,
    session_id: session.id,
    user: publicActor(profileToActor(profile, session.id, 'extension')),
  });
}

async function handleLogout(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  if (actor.sessionId) {
    await ctx.db
      .from('totp_sessions')
      .update({ revoked_at: new Date().toISOString(), revoked_by: actor.userId, revoked_reason: 'logout' })
      .eq('id', actor.sessionId);
    await writeAudit(ctx, { event_type: 'LOGOUT', session_id: actor.sessionId });
  }
  return json(ctx.origin, { ok: true });
}

async function handleStepUp(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  const password = String(ctx.body.password ?? '');
  if (!password) throw new HttpError(400, 'Informe sua senha do CRM.');
  if (!actor.sessionId) throw new HttpError(400, 'Sessão indisponível para confirmação.');

  await enforce(ctx, 'totp-step-up', [
    { bucketType: 'identity', value: actor.userId, limit: 10, windowSeconds: 600, blockSeconds: 1800 },
    { bucketType: 'ip', limit: 30, windowSeconds: 600, blockSeconds: 1800 },
  ]);

  if (!(await verifyPassword(ctx, actor.email, password))) {
    await writeAudit(ctx, { event_type: 'STEP_UP_FAILED' });
    throw new HttpError(401, 'Senha incorreta.');
  }

  const token = randomToken(32);
  await ctx.db
    .from('totp_sessions')
    .update({
      step_up_token_hash: await sha256Hex(token),
      step_up_expires_at: new Date(Date.now() + STEP_UP_TTL_SECONDS * 1000).toISOString(),
    })
    .eq('id', actor.sessionId);

  await writeAudit(ctx, { event_type: 'STEP_UP_COMPLETED' });
  return json(ctx.origin, { step_up_token: token, expires_in: STEP_UP_TTL_SECONDS });
}

async function handleMe(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  // "Tem PIN?" pergunta ao PIN DO SISTEMA — o mesmo de Meu Perfil → Segurança.
  const { data: temPin } = await ctx.db.rpc('totp_has_security_pin', { p_user_id: actor.userId });

  return json(ctx.origin, {
    user: publicActor(actor),
    session: { id: actor.sessionId, kind: actor.sessionKind },
    admin_pin_configured: temPin === true,
  });
}

async function handleListSessions(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  const { data, error } = await ctx.db
    .from('totp_sessions')
    .select('id, kind, device_name, device_id, user_agent, ip, created_at, last_used_at, revoked_at, revoked_reason')
    .eq('user_id', actor.userId)
    .order('last_used_at', { ascending: false })
    .limit(50);

  if (error) throw new HttpError(500, 'Não foi possível listar os dispositivos.', error.message);

  return json(ctx.origin, {
    sessions: (data ?? []).map((row) => ({
      ...row,
      is_current: row.id === actor.sessionId,
      // O IP completo é dado de rastreio; a lista mostra só o suficiente.
      ip: row.ip ? `${String(row.ip).split('.').slice(0, 2).join('.')}.•.•` : null,
    })),
  });
}

async function handleRevokeSession(ctx: Ctx, sessionId: string): Promise<Response> {
  const actor = requireActor(ctx);

  const { data: target } = await ctx.db
    .from('totp_sessions')
    .select('id, user_id')
    .eq('id', sessionId)
    .maybeSingle();

  // Cada um derruba só os próprios dispositivos. Administrador derruba os
  // dos outros pelo painel — e isso fica auditado como intervenção.
  const proprio = target?.user_id === actor.userId;
  const comoAdmin = !proprio && adminCan(actor.isActive, actor.isAdmin, 'revoke_session');
  if (!target || (!proprio && !comoAdmin)) {
    throw new HttpError(404, 'Dispositivo não encontrado.');
  }

  await ctx.db
    .from('totp_sessions')
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: actor.userId,
      // Distinguir os dois casos importa na auditoria: "o dono desconectou o
      // próprio celular" e "o painel derrubou o dispositivo de alguém" contam
      // histórias diferentes.
      revoked_reason: comoAdmin ? 'revoked_by_admin' : 'revoked_by_user',
    })
    .eq('id', sessionId)
    .is('revoked_at', null);

  await writeAudit(ctx, {
    event_type: 'SESSION_REVOKED',
    target_user_id: target.user_id,
    session_id: sessionId,
    metadata_safe: { by_admin: target.user_id !== actor.userId },
  });

  return json(ctx.origin, { ok: true });
}

// ============================================================================
// HANDLERS — credenciais
// ============================================================================

type CredentialSummary = {
  id: string;
  name: string;
  issuer: string | null;
  account_label: string | null;
  digits: number;
  period: number;
  algorithm: string;
  status: string;
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
};

async function accessibleCredentials(ctx: Ctx, actor: Actor): Promise<CredentialRow[]> {
  const { data: shares, error: sharesError } = await ctx.db
    .from('totp_permissions')
    .select('credential_id')
    .eq('user_id', actor.userId);
  if (sharesError) throw new HttpError(500, 'Não foi possível listar suas chaves.', sharesError.message);

  const sharedIds = (shares ?? []).map((row) => row.credential_id as string);

  const { data: owned, error: ownedError } = await ctx.db
    .from('totp_credentials')
    .select(CREDENTIAL_COLUMNS)
    .eq('owner_user_id', actor.userId)
    .neq('status', 'deleted');
  if (ownedError) throw new HttpError(500, 'Não foi possível listar suas chaves.', ownedError.message);

  let sharedRows: CredentialRow[] = [];
  if (sharedIds.length > 0) {
    const { data, error } = await ctx.db
      .from('totp_credentials')
      .select(CREDENTIAL_COLUMNS)
      .in('id', sharedIds)
      .neq('status', 'deleted');
    if (error) throw new HttpError(500, 'Não foi possível listar suas chaves.', error.message);
    sharedRows = (data ?? []) as unknown as CredentialRow[];
  }

  const byId = new Map<string, CredentialRow>();
  for (const row of [...((owned ?? []) as unknown as CredentialRow[]), ...sharedRows]) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function summarize(ctx: Ctx, actor: Actor, rows: CredentialRow[]): Promise<CredentialSummary[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [{ data: perms }, { data: favorites }, { data: owners }] = await Promise.all([
    ctx.db.from('totp_permissions').select('credential_id, user_id, permission').in('credential_id', ids),
    ctx.db.from('totp_favorites').select('credential_id').eq('user_id', actor.userId).in('credential_id', ids),
    ctx.db.from('profiles').select('user_id, name').in('user_id', [...new Set(rows.map((row) => row.owner_user_id))]),
  ]);

  const mine = new Map<string, VaultPermission>();
  const counts = new Map<string, number>();
  for (const perm of perms ?? []) {
    counts.set(perm.credential_id as string, (counts.get(perm.credential_id as string) ?? 0) + 1);
    if (perm.user_id === actor.userId) mine.set(perm.credential_id as string, perm.permission as VaultPermission);
  }

  const favoriteIds = new Set((favorites ?? []).map((row) => row.credential_id as string));
  const ownerNames = new Map((owners ?? []).map((row) => [row.user_id as string, row.name as string | null]));

  return rows.map((row) => {
    const acl: AclInput = {
      actorUserId: actor.userId,
      actorIsActive: actor.isActive,
      actorIsAdmin: actor.isAdmin,
      ownerUserId: row.owner_user_id,
      grantedPermission: mine.get(row.id) ?? null,
      credentialStatus: row.status,
    };
    return {
      id: row.id,
      name: row.name,
      issuer: row.issuer,
      account_label: row.account_label,
      digits: row.digits,
      period: row.period,
      algorithm: row.algorithm,
      status: row.status,
      owner_user_id: row.owner_user_id,
      owner_name: ownerNames.get(row.owner_user_id) ?? null,
      is_owner: row.owner_user_id === actor.userId,
      role: resolveRole(acl),
      shared: (counts.get(row.id) ?? 0) > 0,
      shared_count: counts.get(row.id) ?? 0,
      favorite: favoriteIds.has(row.id),
      can_export: can(acl, 'export_secret'),
      can_manage: can(acl, 'share'),
      created_at: row.created_at,
    };
  }).sort((a, b) => {
    if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
    return a.name.localeCompare(b.name, 'pt-BR');
  });
}

async function handleListCredentials(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  const rows = await accessibleCredentials(ctx, actor);
  return json(ctx.origin, { credentials: await summarize(ctx, actor, rows) });
}

/**
 * Um pedido, todos os códigos. O popup abre e já mostra tudo — sem isto seriam
 * N requisições, e a extensão só pareceria instantânea com cache de segredo,
 * que é exatamente o que não pode existir.
 */
// Duas horas: um turno de trabalho, não um dia inteiro.
//
// Já foi "toda vez", e era hostil — quem confere quatro códigos numa manhã
// digitava o PIN quatro vezes. O destravamento é propriedade da SESSÃO, não um
// token que a aba carrega: assim ele sobrevive a um F5 e vale para as abas
// daquele navegador, que é exatamente o alcance que "2 horas aqui" sugere.
const PIN_UNLOCK_TTL_SECONDS = 2 * 60 * 60;

/**
 * Destravamento por PIN — a trava do atalho do CRM.
 *
 * Só vale para sessão do tipo `web`. O navegador do CRM fica aberto na mesa e
 * quem senta nele herda a sessão; a extensão vive num dispositivo específico,
 * atrás do próprio login, e cobrar PIN a cada código a tornaria inútil.
 *
 * Isto NÃO é enfeite de tela: sem o token, `/codes` recusa mesmo que a chamada
 * venha do DevTools com o JWT certo.
 */
async function requirePinUnlock(ctx: Ctx, actor: Actor): Promise<void> {
  if (actor.sessionKind !== 'web') return;
  if (!actor.sessionId) throw new HttpError(401, 'Sessão inválida.');

  const { data: sessao } = await ctx.db
    .from('totp_sessions')
    .select('pin_unlock_expires_at')
    .eq('id', actor.sessionId)
    .maybeSingle();

  if (!sessao?.pin_unlock_expires_at) {
    throw new HttpError(428, 'Confirme seu PIN para ver os códigos.');
  }
  if (new Date(sessao.pin_unlock_expires_at as string).getTime() <= Date.now()) {
    throw new HttpError(428, 'A confirmação do PIN expirou. Confirme de novo.');
  }
}

async function handleUnlock(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  if (!actor.sessionId) throw new HttpError(401, 'Sessão inválida.');

  await enforce(ctx, 'totp-pin-unlock', [
    { bucketType: 'identity', value: actor.userId, limit: 20, windowSeconds: 900, blockSeconds: 900 },
    { bucketType: 'ip', limit: 60, windowSeconds: 900, blockSeconds: 900 },
  ]);

  const { data, error } = await ctx.db.rpc('totp_verify_security_pin', {
    p_user_id: actor.userId,
    p_pin: String(ctx.body.pin ?? ''),
    p_action: 'totp_vault_unlock',
  });
  if (error) throw new HttpError(500, 'Não foi possível conferir o PIN.', error.message);

  const r = (data ?? {}) as { ok?: boolean; error?: string; locked_until?: string; attempts_left?: number };

  if (r.ok !== true) {
    await writeAudit(ctx, { event_type: 'PIN_UNLOCK_FAILED', metadata_safe: { why: r.error ?? 'desconhecido' } });

    if (r.error === 'no_pin') {
      throw new HttpError(400, 'Você ainda não tem PIN de segurança. Cadastre em Meu Perfil → Segurança.');
    }
    if (r.error === 'locked') {
      const restam = r.locked_until ? new Date(r.locked_until).getTime() - Date.now() : 900_000;
      throw new HttpError(429, `PIN bloqueado. Tente em ${Math.max(1, Math.ceil(restam / 60_000))} min.`);
    }
    throw new HttpError(
      401,
      typeof r.attempts_left === 'number' ? `PIN incorreto. Restam ${r.attempts_left} tentativas.` : 'PIN incorreto.',
    );
  }

  const venceEm = new Date(Date.now() + PIN_UNLOCK_TTL_SECONDS * 1000).toISOString();
  await ctx.db
    .from('totp_sessions')
    .update({ pin_unlock_expires_at: venceEm, pin_unlock_hash: null })
    .eq('id', actor.sessionId);

  await writeAudit(ctx, { event_type: 'PIN_UNLOCK_COMPLETED' });

  return json(ctx.origin, { expires_in: PIN_UNLOCK_TTL_SECONDS, expires_at: venceEm });
}

async function handleUnlockStatus(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  if (actor.sessionKind !== 'web' || !actor.sessionId) {
    return json(ctx.origin, { unlocked: true, expires_at: null });
  }
  const { data } = await ctx.db
    .from('totp_sessions')
    .select('pin_unlock_expires_at')
    .eq('id', actor.sessionId)
    .maybeSingle();

  const venceEm = data?.pin_unlock_expires_at as string | null | undefined;
  const valido = Boolean(venceEm && new Date(venceEm).getTime() > Date.now());
  return json(ctx.origin, { unlocked: valido, expires_at: valido ? venceEm : null });
}

async function handleLock(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  if (actor.sessionId) {
    // Fechar o painel tranca de novo na hora, sem esperar o prazo vencer.
    await ctx.db
      .from('totp_sessions')
      .update({ pin_unlock_hash: null, pin_unlock_expires_at: null })
      .eq('id', actor.sessionId);
  }
  return json(ctx.origin, { ok: true });
}

async function handleCodes(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  await requirePinUnlock(ctx, actor);
  const rows = (await accessibleCredentials(ctx, actor)).filter((row) => row.status === 'active');

  const requested = Array.isArray(ctx.body.credential_ids)
    ? new Set((ctx.body.credential_ids as unknown[]).map(String))
    : null;

  const now = Date.now();
  const codes: Record<string, unknown>[] = [];
  const auditable: string[] = [];

  for (const row of rows) {
    if (requested && !requested.has(row.id)) continue;
    try {
      const secret = await openSecret(keyring(), sealedFrom(row));
      const result = await generateTotp({
        secret: base32Decode(secret),
        algorithm: row.algorithm,
        digits: row.digits,
        period: row.period,
        timestampMs: now,
      });
      codes.push({
        credential_id: row.id,
        code: result.code,
        digits: result.digits,
        period: result.period,
        expires_in: result.expiresIn,
        valid_from: Math.floor(result.validFrom / 1000),
      });
      auditable.push(row.id);
    } catch (error) {
      // Erro técnico fica no servidor; o cliente vê que aquela chave falhou.
      safeError(SCOPE, `falha ao gerar código da credencial ${row.id}`, error);
      codes.push({ credential_id: row.id, error: 'Não foi possível gerar o código desta credencial.' });
    }
  }

  await auditCodeAccess(ctx, actor, auditable);
  // O relógio do servidor vai junto: o contador da extensão não pode depender
  // de o computador de quem usa estar com a hora certa.
  return json(ctx.origin, { codes, server_time: Math.floor(now / 1000) });
}

async function handleCode(ctx: Ctx, credentialId: string): Promise<Response> {
  const actor = requireActor(ctx);
  await requirePinUnlock(ctx, actor);
  const { row } = await loadAuthorized(ctx, actor, credentialId, 'read_code');

  const secret = await openSecret(keyring(), sealedFrom(row));
  const result = await generateTotp({
    secret: base32Decode(secret),
    algorithm: row.algorithm,
    digits: row.digits,
    period: row.period,
  });

  await auditCodeAccess(ctx, actor, [row.id]);

  // Repare no que NÃO está aqui: `secret`.
  return json(ctx.origin, {
    code: result.code,
    digits: result.digits,
    period: result.period,
    expires_in: result.expiresIn,
    server_time: Math.floor(Date.now() / 1000),
  });
}

/**
 * CODE_ACCESSED de 30 em 30 segundos inundaria a auditoria e a tornaria
 * inútil. Registra-se uma vez por chave a cada 15 minutos: continua provando
 * quem usou o quê e quando, sem virar ruído.
 */
async function auditCodeAccess(ctx: Ctx, actor: Actor, credentialIds: string[]): Promise<void> {
  if (credentialIds.length === 0) return;

  const since = new Date(Date.now() - CODE_AUDIT_WINDOW_MINUTES * 60 * 1000).toISOString();
  const { data: recent } = await ctx.db
    .from('totp_audit_logs')
    .select('credential_id')
    .eq('event_type', 'CODE_ACCESSED')
    .eq('actor_user_id', actor.userId)
    .gte('created_at', since)
    .in('credential_id', credentialIds);

  const already = new Set((recent ?? []).map((row) => row.credential_id as string));
  const missing = credentialIds.filter((id) => !already.has(id));
  if (missing.length === 0) return;

  try {
    await ctx.db.from('totp_audit_logs').insert(missing.map((credentialId) => ({
      event_type: 'CODE_ACCESSED',
      actor_user_id: actor.userId,
      credential_id: credentialId,
      session_id: actor.sessionId,
      ip: ctx.ip,
      user_agent: ctx.userAgent?.slice(0, 400) ?? null,
      metadata_safe: { window_minutes: CODE_AUDIT_WINDOW_MINUTES },
    })));
  } catch (error) {
    safeError(SCOPE, 'falha ao auditar acesso a código', error);
  }
}

function readEntryFromBody(body: Record<string, unknown>): ParsedTotpEntry {
  const secret = normalizeBase32(String(body.secret ?? ''));
  if (!isValidBase32(secret)) throw new HttpError(400, 'O segredo informado não é um base32 válido.');

  const name = String(body.name ?? '').trim();
  if (!name || name.length > 120) throw new HttpError(400, 'Dê um nome de 1 a 120 caracteres para a chave.');

  try {
    return {
      name,
      issuer: body.issuer ? String(body.issuer).trim().slice(0, 120) : null,
      accountLabel: body.account_label ? String(body.account_label).trim().slice(0, 200) : null,
      secret,
      algorithm: normalizeAlgorithm(body.algorithm),
      digits: normalizeDigits(body.digits),
      period: normalizePeriod(body.period),
    };
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : 'Parâmetros inválidos.');
  }
}

async function createCredential(
  ctx: Ctx,
  actor: Actor,
  entry: ParsedTotpEntry,
  ownerUserId: string,
): Promise<{ id: string; name: string }> {
  // O id nasce aqui, e não no banco, porque ele entra no AAD do envelope: é o
  // que amarra o ciphertext à linha.
  const id = crypto.randomUUID();
  const sealed = await sealSecret(keyring(), id, entry.secret);
  const fingerprint = await fingerprintSecret(fingerprintPepper(), entry.secret);

  const { error } = await ctx.db.from('totp_credentials').insert({
    id,
    owner_user_id: ownerUserId,
    name: entry.name,
    issuer: entry.issuer,
    account_label: entry.accountLabel,
    algorithm: entry.algorithm,
    digits: entry.digits,
    period: entry.period,
    secret_ciphertext: bytesToPgHex(sealed.secretCiphertext),
    secret_iv: bytesToPgHex(sealed.secretIv),
    wrapped_dek: bytesToPgHex(sealed.wrappedDek),
    dek_iv: bytesToPgHex(sealed.dekIv),
    key_version: sealed.keyVersion,
    crypto_version: sealed.cryptoVersion,
    secret_fingerprint: fingerprint,
    created_by: actor.userId,
  });

  if (error) throw new HttpError(500, 'Não foi possível guardar a chave.', error.message);

  await writeAudit(ctx, {
    event_type: 'CREDENTIAL_CREATED',
    credential_id: id,
    target_user_id: ownerUserId,
    metadata_safe: {
      name: entry.name,
      issuer: entry.issuer,
      algorithm: entry.algorithm,
      digits: entry.digits,
      period: entry.period,
      on_behalf_of: ownerUserId !== actor.userId,
    },
  });

  return { id, name: entry.name };
}

async function handleCreateCredential(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  const entry = readEntryFromBody(ctx.body);

  // `owner_user_id` do corpo só vale para administrador, e vira auditoria.
  const requestedOwner = ctx.body.owner_user_id ? String(ctx.body.owner_user_id) : null;
  const ownerUserId = await resolveOwner(ctx, actor, requestedOwner);

  const created = await createCredential(ctx, actor, entry, ownerUserId);
  return json(ctx.origin, { credential: created }, 201);
}

async function resolveOwner(ctx: Ctx, actor: Actor, requested: string | null): Promise<string> {
  if (!requested || requested === actor.userId) return actor.userId;
  if (!actor.isAdmin) throw new HttpError(403, 'Só um administrador cadastra chave em nome de outra pessoa.');

  const profile = await loadProfile(ctx.db, requested);
  if (!profile || profile.is_active !== true) throw new HttpError(400, 'Usuário de destino inválido.');
  return requested;
}

async function handleUpdateCredential(ctx: Ctx, credentialId: string): Promise<Response> {
  const actor = requireActor(ctx);
  const { row } = await loadAuthorized(ctx, actor, credentialId, 'update', METADATA_COLUMNS);

  const patch: Record<string, unknown> = {};
  if (ctx.body.name !== undefined) {
    const name = String(ctx.body.name).trim();
    if (!name || name.length > 120) throw new HttpError(400, 'O nome precisa ter de 1 a 120 caracteres.');
    patch.name = name;
  }
  if (ctx.body.issuer !== undefined) patch.issuer = ctx.body.issuer ? String(ctx.body.issuer).trim().slice(0, 120) : null;
  if (ctx.body.account_label !== undefined) {
    patch.account_label = ctx.body.account_label ? String(ctx.body.account_label).trim().slice(0, 200) : null;
  }
  if (ctx.body.status !== undefined) {
    const status = String(ctx.body.status);
    if (!['active', 'archived'].includes(status)) throw new HttpError(400, 'Status inválido.');
    patch.status = status;
  }

  // Mass assignment fechado por lista branca: `owner_user_id`, `key_version`,
  // `secret_ciphertext` e companhia NÃO entram por PATCH, aconteça o que
  // acontecer no corpo.
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'Nada para alterar.');

  const { error } = await ctx.db.from('totp_credentials').update(patch).eq('id', row.id);
  if (error) throw new HttpError(500, 'Não foi possível salvar a alteração.', error.message);

  await writeAudit(ctx, {
    event_type: 'CREDENTIAL_UPDATED',
    credential_id: row.id,
    target_user_id: row.owner_user_id,
    metadata_safe: { fields: Object.keys(patch) },
  });

  return json(ctx.origin, { ok: true });
}

async function handleDeleteCredential(ctx: Ctx, credentialId: string): Promise<Response> {
  const actor = requireActor(ctx);
  const { row } = await loadAuthorized(ctx, actor, credentialId, 'delete', METADATA_COLUMNS);

  // Soft-delete: chave sensível não some sem rastro. A retenção é decidida por
  // política, não por um clique.
  const { error } = await ctx.db
    .from('totp_credentials')
    .update({
      status: 'deleted',
      deleted_at: new Date().toISOString(),
      deleted_by: actor.userId,
      deleted_reason: ctx.body.reason ? String(ctx.body.reason).slice(0, 500) : null,
    })
    .eq('id', row.id)
    .neq('status', 'deleted');

  if (error) throw new HttpError(500, 'Não foi possível excluir a chave.', error.message);

  await ctx.db.from('totp_permissions').delete().eq('credential_id', row.id);

  await writeAudit(ctx, {
    event_type: 'CREDENTIAL_DELETED',
    credential_id: row.id,
    target_user_id: row.owner_user_id,
    reason: ctx.body.reason ? String(ctx.body.reason).slice(0, 500) : null,
    metadata_safe: { name: row.name },
  });

  return json(ctx.origin, { ok: true });
}

async function handleFavorite(ctx: Ctx, credentialId: string): Promise<Response> {
  const actor = requireActor(ctx);
  const { row } = await loadAuthorized(ctx, actor, credentialId, 'read_metadata', METADATA_COLUMNS);
  const favorite = ctx.body.favorite === true;

  if (favorite) {
    await ctx.db.from('totp_favorites').upsert({ user_id: actor.userId, credential_id: row.id });
  } else {
    await ctx.db.from('totp_favorites').delete().eq('user_id', actor.userId).eq('credential_id', row.id);
  }

  return json(ctx.origin, { ok: true, favorite });
}

async function handleTransfer(ctx: Ctx, credentialId: string): Promise<Response> {
  const actor = requireActor(ctx);
  const { row } = await loadAuthorized(ctx, actor, credentialId, 'transfer', METADATA_COLUMNS);

  const newOwner = String(ctx.body.new_owner_user_id ?? '').trim();
  if (!newOwner || newOwner === row.owner_user_id) throw new HttpError(400, 'Escolha outro usuário.');

  const profile = await loadProfile(ctx.db, newOwner);
  if (!profile || profile.is_active !== true) throw new HttpError(400, 'Usuário de destino inválido.');

  await requireStepUp(ctx, actor, ctx.body.step_up_token);

  const previousOwner = row.owner_user_id;

  // Trocar o dono e acertar a ACL viraram UMA transação no banco: falhar no
  // meio deixava chave com dono novo e ACL do dono velho, um estado que
  // nenhuma tela sabe mostrar. A função devolve false quando a corrida foi
  // perdida — o dono mudou enquanto esta chamada pensava.
  //
  // O dono antigo não pode perder o acesso por acidente: vira MANAGE.
  const { data: transferiu, error } = await ctx.db.rpc('totp_transfer_ownership', {
    p_credential_id: row.id,
    p_previous_owner: previousOwner,
    p_new_owner: newOwner,
    p_actor: actor.userId,
    p_keep_previous_as_manage: true,
  });
  if (error) throw new HttpError(500, 'Não foi possível transferir a chave.', error.message);
  if (transferiu !== true) {
    throw new HttpError(409, 'A propriedade mudou enquanto você confirmava. Recarregue e tente de novo.');
  }

  await writeAuditStrict(ctx, {
    event_type: 'CREDENTIAL_TRANSFERRED',
    credential_id: row.id,
    target_user_id: newOwner,
    reason: ctx.body.reason ? String(ctx.body.reason).slice(0, 500) : null,
    metadata_safe: { previous_owner: previousOwner, new_owner: newOwner, previous_owner_kept: 'MANAGE' },
  });

  await notifyUser(ctx, {
    userId: newOwner,
    type: 'totp_transferred',
    title: 'Uma chave passou a ser sua',
    message: `${await actorDisplayName(ctx, actor)} transferiu "${credentialLabel(row)}" para você. Como dono, você pode compartilhar e exportar.`,
    metadata: { credential_id: row.id, credential_name: row.name, previous_owner: previousOwner },
  });

  await consumeStepUp(ctx, actor);
  return json(ctx.origin, { ok: true });
}

// ── permissões ──────────────────────────────────────────────────────────────

async function handleListPermissions(ctx: Ctx, credentialId: string): Promise<Response> {
  const actor = requireActor(ctx);
  const { row } = await loadAuthorized(ctx, actor, credentialId, 'read_metadata', METADATA_COLUMNS);

  const { data: perms, error } = await ctx.db
    .from('totp_permissions')
    .select('user_id, permission, created_at')
    .eq('credential_id', row.id);
  if (error) throw new HttpError(500, 'Não foi possível listar os compartilhamentos.', error.message);

  const userIds = [...new Set([row.owner_user_id, ...(perms ?? []).map((p) => p.user_id as string)])];
  const { data: profiles } = await ctx.db
    .from('profiles')
    .select('user_id, name, email, avatar_url, is_active')
    .in('user_id', userIds);

  const byUser = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));
  const owner = byUser.get(row.owner_user_id);

  return json(ctx.origin, {
    owner: {
      user_id: row.owner_user_id,
      name: owner?.name ?? null,
      email: owner?.email ?? null,
      avatar_url: owner?.avatar_url ?? null,
      permission: 'OWNER',
    },
    permissions: (perms ?? []).map((perm) => {
      const profile = byUser.get(perm.user_id as string);
      return {
        user_id: perm.user_id,
        name: profile?.name ?? null,
        email: profile?.email ?? null,
        avatar_url: profile?.avatar_url ?? null,
        is_active: profile?.is_active ?? false,
        permission: perm.permission,
        created_at: perm.created_at,
      };
    }),
  });
}

/**
 * Conceder acesso a UMA chave. É o miolo compartilhado pelo compartilhamento
 * avulso e pelo em lote — a régua (`share`, `canGrant`) e a auditoria estrita
 * são as mesmas nos dois caminhos, e ficar em um lugar só é o que impede que o
 * lote vire uma porta mais larga que a porta avulsa.
 *
 * Devolve o rótulo da chave, que é o que os avisos precisam saber.
 */
async function grantOneCredential(
  ctx: Ctx,
  actor: Actor,
  credentialId: string,
  targetUserId: string,
  permission: VaultPermission,
): Promise<string> {
  const { row, acl } = await loadAuthorized(ctx, actor, credentialId, 'share', METADATA_COLUMNS);

  if (targetUserId === row.owner_user_id) throw new HttpError(400, 'O proprietário já tem acesso total.');
  if (!canGrant(acl, permission)) {
    throw new HttpError(403, 'Você não pode conceder um nível acima do seu.');
  }

  const { error } = await ctx.db.from('totp_permissions').upsert(
    { credential_id: row.id, user_id: targetUserId, permission, created_by: actor.userId },
    { onConflict: 'credential_id,user_id' },
  );
  if (error) throw new HttpError(500, 'Não foi possível compartilhar.', error.message);

  await writeAuditStrict(ctx, {
    event_type: 'ACCESS_GRANTED',
    credential_id: row.id,
    target_user_id: targetUserId,
    metadata_safe: { permission },
  });

  return credentialLabel(row);
}

/** Teto do lote. Acima disso não é compartilhamento, é exportação de cofre. */
const MAX_BULK_GRANT = 50;

/**
 * Compartilhar uma ou várias chaves com a MESMA pessoa, no mesmo nível.
 *
 * O lote não existe por desempenho: existe para que o aviso seja um só. Quando
 * o frontend concedia uma chave por vez, doze chaves viravam doze notificações
 * e doze e-mails — e o que era um único ato do gerente chegava do outro lado
 * como uma enxurrada. Aqui o backend conhece a lista inteira e fala uma vez.
 *
 * Falha parcial NÃO é desfeita: cada concessão já foi gravada e auditada. A
 * resposta diz quais ficaram para trás, e a tela mantém essas selecionadas.
 */
async function grantCredentials(ctx: Ctx, credentialIds: string[]): Promise<Response> {
  const actor = requireActor(ctx);

  const targetUserId = String(ctx.body.user_id ?? '').trim();
  const permission = String(ctx.body.permission ?? 'USE').toUpperCase() as VaultPermission;

  if (!['USE', 'MANAGE', 'EXPORT'].includes(permission)) throw new HttpError(400, 'Permissão inválida.');
  if (!targetUserId) throw new HttpError(400, 'Escolha um usuário.');

  const ids = Array.from(new Set(credentialIds.filter((id) => typeof id === 'string' && id.trim())));
  if (ids.length === 0) throw new HttpError(400, 'Escolha ao menos uma chave.');
  if (ids.length > MAX_BULK_GRANT) throw new HttpError(400, `Compartilhe no máximo ${MAX_BULK_GRANT} chaves por vez.`);

  // Nunca "criar" um usuário a partir de e-mail digitado: o destino tem de ser
  // um perfil ativo que já existe no CRM.
  const profile = await loadProfile(ctx.db, targetUserId);
  if (!profile || profile.is_active !== true) throw new HttpError(400, 'Usuário inválido ou desativado.');

  // EXPORT é privilégio sério: exige step-up de quem concede. Um step-up cobre
  // o lote inteiro — é o mesmo ato, na mesma janela de 5 minutos.
  if (permission === 'EXPORT') await requireStepUp(ctx, actor, ctx.body.step_up_token);

  const concedidas: { id: string; label: string }[] = [];
  const falhas: string[] = [];
  let primeiroErro: unknown = null;

  for (const id of ids) {
    try {
      const label = await grantOneCredential(ctx, actor, id, targetUserId, permission);
      concedidas.push({ id, label });
    } catch (error) {
      falhas.push(id);
      if (!primeiroErro) primeiroErro = error;
    }
  }

  const chaves = concedidas.map((c) => c.label);

  // Nada passou: o erro real vale mais do que um "0 de 3 compartilhadas".
  if (chaves.length === 0 && primeiroErro) throw primeiroErro;

  const quem = await actorDisplayName(ctx, actor);
  const varias = chaves.length > 1;

  await notifyUser(ctx, {
    userId: targetUserId,
    type: 'totp_shared',
    title: varias
      ? `${quem} compartilhou ${chaves.length} chaves com você`
      : `${quem} compartilhou uma chave com você`,
    message: varias
      ? `${chaves.join(', ')} — ${permission === 'USE' ? 'você já pode gerar os códigos' : `acesso ${permission}`} no Authenticator.`
      : permission === 'USE'
        ? `Você já pode gerar os códigos de "${chaves[0]}" no Authenticator.`
        : `Você recebeu acesso ${permission} a "${chaves[0]}" no Authenticator.`,
    metadata: {
      credential_ids: concedidas.map((c) => c.id),
      credential_names: chaves,
      permission,
      granted_by: actor.userId,
    },
  });

  await emailSharedCredentials(ctx, {
    userId: targetUserId,
    actorName: quem,
    credentialNames: chaves,
    permission,
  });

  if (permission === 'EXPORT') await consumeStepUp(ctx, actor);

  return json(ctx.origin, { ok: true, granted: chaves.length, failed: falhas });
}

async function handleGrantPermission(ctx: Ctx, credentialId: string): Promise<Response> {
  return grantCredentials(ctx, [credentialId]);
}

/** `POST /permissions/bulk` — várias chaves, uma pessoa, um aviso só. */
async function handleGrantPermissionsBulk(ctx: Ctx): Promise<Response> {
  const raw = ctx.body.credential_ids;
  const ids = Array.isArray(raw) ? raw.map((v) => String(v ?? '').trim()) : [];
  return grantCredentials(ctx, ids);
}

async function handleRevokePermission(ctx: Ctx, credentialId: string, targetUserId: string): Promise<Response> {
  const actor = requireActor(ctx);

  // Sair de uma chave é direito de quem recebeu.
  //
  // Só MANAGE revogava, e isso deixava quem tem USE preso a um acesso que não
  // pediu: para largar a chave era preciso pedir ao dono. Mas tirar o PRÓPRIO
  // acesso não é escalada — é a única direção em que a pessoa só perde poder,
  // e por isso não passa pela régua de `share`.
  //
  // Vem antes de tudo porque é o caso mais restrito: alvo e ator são a mesma
  // pessoa. O dono não cabe aqui — ele não tem linha em `totp_permissions`, e
  // largar a própria chave é transferir ou apagar, não revogar.
  const saindoDaPropriaChave = targetUserId === actor.userId;

  let row: { id: string; owner_user_id: string; name: string };
  try {
    // Para sair, basta enxergar a chave: quem tem USE já a enxerga.
    const acao = saindoDaPropriaChave ? 'read_metadata' : 'share';
    const authorized = await loadAuthorized(ctx, actor, credentialId, acao, METADATA_COLUMNS);
    row = authorized.row;
  } catch (error) {
    if (!(error instanceof HttpError) || !adminCan(actor.isActive, actor.isAdmin, 'revoke_share')) throw error;
    const { data } = await ctx.db
      .from('totp_credentials')
      .select('id, owner_user_id, name')
      .eq('id', credentialId)
      .maybeSingle();
    if (!data) throw new HttpError(404, 'Credencial não encontrada.');
    row = data as { id: string; owner_user_id: string; name: string };
  }

  // FORA do try de propósito: dentro dele, o catch de administrador engoliria
  // esta recusa e um admin dono da chave passaria batido por ela.
  if (saindoDaPropriaChave && row.owner_user_id === actor.userId) {
    throw new HttpError(
      400,
      'Esta chave é sua. Para deixar de tê-la, transfira a propriedade ou exclua a chave.',
    );
  }

  const { error } = await ctx.db
    .from('totp_permissions')
    .delete()
    .eq('credential_id', row.id)
    .eq('user_id', targetUserId);
  if (error) throw new HttpError(500, 'Não foi possível remover o acesso.', error.message);

  await writeAuditStrict(ctx, {
    event_type: 'ACCESS_REVOKED',
    credential_id: row.id,
    target_user_id: targetUserId,
    metadata_safe: {
      by_admin: !saindoDaPropriaChave && row.owner_user_id !== actor.userId && actor.isAdmin,
      // Sem isto, sair da chave e ser expulso dela ficam iguais no registro —
      // e são fatos diferentes na hora de entender o que aconteceu.
      self_removed: saindoDaPropriaChave,
    },
  });

  if (saindoDaPropriaChave) {
    // Quem saiu já sabe que saiu. Quem precisa saber é o DONO: para ele, um
    // acesso que ele concedeu simplesmente deixou de existir, e descobrir isso
    // só ao conferir a lista é descobrir tarde.
    await notifyUser(ctx, {
      userId: row.owner_user_id,
      type: 'totp_revoked',
      title: `${await actorDisplayName(ctx, actor)} saiu de uma chave sua`,
      message: `A pessoa removeu o próprio acesso a "${row.name}". Se ela precisar de novo, compartilhe outra vez.`,
      metadata: { credential_id: row.id, credential_name: row.name, left_by: actor.userId },
    });
  } else {
    // Avisar também quando o acesso SAI. Descobrir que uma chave sumiu bem na
    // hora de usá-la é pior do que saber antes que ela foi retirada.
    await notifyUser(ctx, {
      userId: targetUserId,
      type: 'totp_revoked',
      title: 'Seu acesso a uma chave foi removido',
      message: `Você não gera mais os códigos de "${row.name}" no Authenticator.`,
      metadata: { credential_id: row.id, credential_name: row.name, revoked_by: actor.userId },
    });
  }

  // A revogação vale AGORA: a extensão não guarda segredo, e o código só sai
  // depois de o backend reconsultar a ACL. Não há cache para esperar vencer.
  return json(ctx.origin, { ok: true });
}

/**
 * Lista, numa chamada só, os acessos concedidos nas chaves que a pessoa pode
 * gerenciar. Não é uma listagem administrativa: cargo nenhum amplia o escopo;
 * entram apenas chaves próprias ou recebidas com MANAGE/EXPORT.
 */
async function handleListShares(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  const rows = (await accessibleCredentials(ctx, actor)).filter((row) => row.status !== 'deleted');
  if (rows.length === 0) return json(ctx.origin, { shares: [] });

  const ids = rows.map((row) => row.id);
  const { data: actorPermissions, error: actorPermissionsError } = await ctx.db
    .from('totp_permissions')
    .select('credential_id, permission')
    .eq('user_id', actor.userId)
    .in('credential_id', ids);
  if (actorPermissionsError) {
    throw new HttpError(500, 'Não foi possível listar os compartilhamentos.', actorPermissionsError.message);
  }

  const manageableIds = new Set(
    rows.filter((row) => row.owner_user_id === actor.userId).map((row) => row.id),
  );
  for (const permission of actorPermissions ?? []) {
    if (permission.permission === 'MANAGE' || permission.permission === 'EXPORT') {
      manageableIds.add(permission.credential_id as string);
    }
  }

  const manageableRows = rows.filter((row) => manageableIds.has(row.id));
  if (manageableRows.length === 0) return json(ctx.origin, { shares: [] });

  const { data: permissions, error } = await ctx.db
    .from('totp_permissions')
    .select('credential_id, user_id, permission, created_at')
    .in('credential_id', manageableRows.map((row) => row.id))
    // Um gerente compartilhado não vê a própria linha como algo para revogar.
    .neq('user_id', actor.userId);
  if (error) throw new HttpError(500, 'Não foi possível listar os compartilhamentos.', error.message);

  const profileIds = [...new Set([
    ...manageableRows.map((row) => row.owner_user_id),
    ...(permissions ?? []).map((permission) => permission.user_id as string),
  ])];
  const { data: profiles, error: profilesError } = await ctx.db
    .from('profiles')
    .select('user_id, name, email, is_active')
    .in('user_id', profileIds);
  if (profilesError) throw new HttpError(500, 'Não foi possível identificar os usuários.', profilesError.message);

  const rowsById = new Map(manageableRows.map((row) => [row.id, row]));
  const profilesById = new Map((profiles ?? []).map((profile) => [profile.user_id as string, profile]));

  const shares = (permissions ?? []).map((permission) => {
    const credential = rowsById.get(permission.credential_id as string)!;
    const target = profilesById.get(permission.user_id as string);
    const owner = profilesById.get(credential.owner_user_id);
    return {
      credential_id: credential.id,
      credential_name: credential.name,
      credential_issuer: credential.issuer,
      owner_user_id: credential.owner_user_id,
      owner_name: owner?.name ?? null,
      user_id: permission.user_id,
      name: target?.name ?? null,
      email: target?.email ?? null,
      is_active: target?.is_active === true,
      permission: permission.permission,
      created_at: permission.created_at,
    };
  }).sort((a, b) =>
    a.credential_name.localeCompare(b.credential_name, 'pt-BR')
      || String(a.name ?? a.email ?? '').localeCompare(String(b.name ?? b.email ?? ''), 'pt-BR'));

  return json(ctx.origin, { shares });
}

// ── importação ──────────────────────────────────────────────────────────────

async function handleImport(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  const mode = String(ctx.body.mode ?? 'analyze');
  if (!['analyze', 'commit'].includes(mode)) throw new HttpError(400, 'Modo de importação inválido.');

  let entries: ParsedTotpEntry[] = [];
  let skipped: { name: string; reason: string }[] = [];

  if (typeof ctx.body.payload === 'string' && ctx.body.payload.trim()) {
    try {
      const parsed = parseImportPayload(ctx.body.payload);
      entries = parsed.entries;
      skipped = parsed.skipped;
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : 'Não foi possível ler o conteúdo.');
    }
  } else if (Array.isArray(ctx.body.items)) {
    for (const raw of ctx.body.items as Record<string, unknown>[]) {
      try {
        entries.push(readEntryFromBody(raw));
      } catch (error) {
        skipped.push({
          name: String(raw?.name ?? 'Entrada inválida'),
          reason: error instanceof HttpError ? error.publicMessage : 'Formato inválido.',
        });
      }
    }
  } else {
    throw new HttpError(400, 'Nada para importar.');
  }

  if (entries.length > 200) throw new HttpError(400, 'Importe no máximo 200 contas por vez.');

  const fingerprints = await Promise.all(entries.map((entry) => fingerprintSecret(fingerprintPepper(), entry.secret)));
  const duplicates = await findDuplicates(ctx, actor, fingerprints);

  if (mode === 'analyze') {
    return json(ctx.origin, {
      // Repare: o segredo NÃO volta na análise. O cliente já o tem em memória;
      // devolvê-lo só ampliaria a superfície.
      items: entries.map((entry, index) => ({
        index,
        name: entry.name,
        issuer: entry.issuer,
        account_label: entry.accountLabel,
        algorithm: entry.algorithm,
        digits: entry.digits,
        period: entry.period,
        duplicate: duplicates.get(fingerprints[index]) ?? null,
      })),
      skipped,
    });
  }

  const ownerUserId = await resolveOwner(ctx, actor, ctx.body.owner_user_id ? String(ctx.body.owner_user_id) : null);
  const selected = Array.isArray(ctx.body.selected)
    ? new Set((ctx.body.selected as unknown[]).map(Number))
    : null;

  const created: { id: string; name: string }[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    if (selected && !selected.has(index)) continue;
    created.push(await createCredential(ctx, actor, entries[index], ownerUserId));
  }

  await writeAudit(ctx, {
    event_type: 'IMPORT_COMPLETED',
    target_user_id: ownerUserId,
    metadata_safe: { count: created.length, skipped: skipped.length, on_behalf_of: ownerUserId !== actor.userId },
  });

  return json(ctx.origin, { created, skipped });
}

async function findDuplicates(
  ctx: Ctx,
  actor: Actor,
  fingerprints: string[],
): Promise<Map<string, { credential_id: string; name: string } | null>> {
  const out = new Map<string, { credential_id: string; name: string } | null>();
  if (fingerprints.length === 0) return out;

  // A duplicidade só é reportada dentro do que a pessoa JÁ enxerga — senão o
  // aviso viraria um oráculo sobre o cofre alheio.
  const visible = await accessibleCredentials(ctx, actor);
  const byFingerprint = new Map(visible.map((row) => [row.secret_fingerprint, row]));

  for (const fingerprint of fingerprints) {
    const match = byFingerprint.get(fingerprint);
    out.set(fingerprint, match ? { credential_id: match.id, name: match.name } : null);
  }
  return out;
}

// ── exportação (com step-up) ────────────────────────────────────────────────

async function handleExport(ctx: Ctx, credentialId: string): Promise<Response> {
  const actor = requireActor(ctx);
  const reason = String(ctx.body.reason ?? '').trim();
  if (reason.length < 10) throw new HttpError(400, 'Descreva em ao menos 10 caracteres por que precisa do segredo.');

  const { row } = await loadAuthorized(ctx, actor, credentialId, 'export_secret');

  await enforce(ctx, 'totp-export', [
    { bucketType: 'identity', value: actor.userId, limit: 20, windowSeconds: 3600, blockSeconds: 3600 },
  ]);

  // Fail-closed: exportar segredo sem registro é o pior desfecho possível
  // desta rota. Sem o INSERT da auditoria, a exportação não avança.
  await writeAuditStrict(ctx, {
    event_type: 'EXPORT_REQUESTED',
    credential_id: row.id,
    target_user_id: row.owner_user_id,
    reason,
  });

  await requireStepUp(ctx, actor, ctx.body.step_up_token);

  const secret = await openSecret(keyring(), sealedFrom(row));
  const entry: ParsedTotpEntry = {
    name: row.name,
    issuer: row.issuer,
    accountLabel: row.account_label,
    secret,
    algorithm: row.algorithm,
    digits: row.digits,
    period: row.period,
  };

  // Antes do `return`, sempre: o segredo só sai depois de o registro existir.
  await writeAuditStrict(ctx, {
    event_type: 'EXPORT_COMPLETED',
    credential_id: row.id,
    target_user_id: row.owner_user_id,
    reason,
  });

  await consumeStepUp(ctx, actor);
  return json(ctx.origin, { secret, uri: buildOtpauthUri(entry), name: row.name });
}

// ============================================================================
// HANDLERS — administração
// ============================================================================

function requireAdmin(ctx: Ctx): Actor {
  const actor = requireActor(ctx);
  if (!adminCan(actor.isActive, actor.isAdmin, 'list_all')) {
    throw new HttpError(403, 'Área restrita a administradores.');
  }
  return actor;
}

async function handleAdminCredentials(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx);
  const query = (ctx.url.searchParams.get('q') ?? '').trim();
  const includeDeleted = ctx.url.searchParams.get('include_deleted') === '1';

  let builder = ctx.db
    .from('totp_credentials')
    .select('id, owner_user_id, name, issuer, account_label, algorithm, digits, period, status, created_at, updated_at, key_version')
    .order('created_at', { ascending: false })
    .limit(500);

  if (!includeDeleted) builder = builder.neq('status', 'deleted');
  if (query) builder = builder.or(orIlike(['name', 'issuer'], query));

  const { data, error } = await builder;
  if (error) throw new HttpError(500, 'Não foi possível listar o cofre.', error.message);

  const rows = data ?? [];
  const ids = rows.map((row) => row.id as string);

  const [{ data: perms }, { data: profiles }] = await Promise.all([
    ids.length ? ctx.db.from('totp_permissions').select('credential_id, user_id, permission').in('credential_id', ids) : Promise.resolve({ data: [] as never[] }),
    ctx.db.from('profiles').select('user_id, name, email').in('user_id', [...new Set(rows.map((row) => row.owner_user_id as string))]),
  ]);

  const byCredential = new Map<string, { user_id: string; permission: string; name: string | null }[]>();
  const profileById = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));

  const shareUserIds = [...new Set((perms ?? []).map((p) => p.user_id as string))];
  const { data: shareProfiles } = shareUserIds.length
    ? await ctx.db.from('profiles').select('user_id, name').in('user_id', shareUserIds)
    : { data: [] as never[] };
  const shareNames = new Map((shareProfiles ?? []).map((p) => [p.user_id as string, p.name as string | null]));

  for (const perm of perms ?? []) {
    const list = byCredential.get(perm.credential_id as string) ?? [];
    list.push({
      user_id: perm.user_id as string,
      permission: perm.permission as string,
      name: shareNames.get(perm.user_id as string) ?? null,
    });
    byCredential.set(perm.credential_id as string, list);
  }

  await writeAudit(ctx, { event_type: 'ADMIN_VAULT_LISTED', metadata_safe: { count: rows.length, query: Boolean(query) } });

  // Metadados apenas — nem ciphertext, nem impressão digital, nem segredo.
  return json(ctx.origin, {
    credentials: rows.map((row) => ({
      ...row,
      owner_name: profileById.get(row.owner_user_id as string)?.name ?? null,
      owner_email: profileById.get(row.owner_user_id as string)?.email ?? null,
      shares: byCredential.get(row.id as string) ?? [],
    })),
    active_key_version: keyring().activeVersion,
  });
}

async function handleAdminAudit(ctx: Ctx): Promise<Response> {
  requireAdmin(ctx);

  const limit = Math.min(Number(ctx.url.searchParams.get('limit') ?? 100), 500);
  const eventType = ctx.url.searchParams.get('event_type');
  const credentialId = ctx.url.searchParams.get('credential_id');

  let builder = ctx.db
    .from('totp_audit_logs')
    .select('id, event_type, actor_user_id, target_user_id, credential_id, ip, reason, metadata_safe, created_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (eventType) builder = builder.eq('event_type', eventType);
  if (credentialId) builder = builder.eq('credential_id', credentialId);

  const { data, error } = await builder;
  if (error) throw new HttpError(500, 'Não foi possível ler a auditoria.', error.message);

  const rows = data ?? [];
  const userIds = [...new Set(rows.flatMap((row) => [row.actor_user_id, row.target_user_id]).filter(Boolean))] as string[];
  const { data: profiles } = userIds.length
    ? await ctx.db.from('profiles').select('user_id, name, email').in('user_id', userIds)
    : { data: [] as never[] };
  const byUser = new Map((profiles ?? []).map((p) => [p.user_id as string, p]));

  return json(ctx.origin, {
    events: rows.map((row) => ({
      ...row,
      actor_name: row.actor_user_id ? byUser.get(row.actor_user_id as string)?.name ?? null : null,
      target_name: row.target_user_id ? byUser.get(row.target_user_id as string)?.name ?? null : null,
    })),
  });
}

async function handleAdminSecurity(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx);
  // Metadado do PIN do sistema. Nunca hash, nunca salt — nem para o dono dele.
  const { data: temPin } = await ctx.db.rpc('totp_has_security_pin', { p_user_id: actor.userId });
  const { data: meta } = await ctx.db
    .from('user_security_pins')
    .select('pin_set_at, updated_at, failed_attempts, locked_until, last_verified_at')
    .eq('user_id', actor.userId)
    .maybeSingle();

  // Quantos administradores têm PIN — é o aviso de "só uma pessoa consegue
  // fazer break-glass", que trava a recuperação se ela estiver de férias.
  const { data: admins } = await ctx.db
    .from('profiles')
    .select('user_id, role, badge')
    .eq('is_active', true);

  const idsAdmin = (admins ?? [])
    .filter((linha) => {
      const papel = normalizeRole(String(linha.role ?? ''));
      const selo = normalizeRole(String(linha.badge ?? ''));
      return ADMIN_ROLES.includes(papel) || selo === 'administrador';
    })
    .map((linha) => linha.user_id as string);

  const { count } = idsAdmin.length
    ? await ctx.db
        .from('user_security_pins')
        .select('user_id', { count: 'exact', head: true })
        .in('user_id', idsAdmin)
        .is('removed_at', null)
    : { count: 0 };

  return json(ctx.origin, {
    // Nunca o PIN, nem o hash, nem o salt.
    pin_configured: temPin === true,
    pin_set_at: meta?.pin_set_at ?? null,
    pin_updated_at: meta?.updated_at ?? null,
    locked_until: meta?.locked_until ?? null,
    failed_attempts: meta?.failed_attempts ?? 0,
    last_used_at: meta?.last_verified_at ?? null,
    // O cofre não cadastra PIN: ele usa o do sistema, cadastrado no perfil.
    pin_origem: 'sistema',
    admins_with_pin: count ?? 0,
    admins_total: idsAdmin.length,
    active_key_version: keyring().activeVersion,
    key_versions: keyring().versions(),
  });
}

async function handleAdminSetPin(ctx: Ctx): Promise<Response> {
  // O cofre NÃO cadastra mais PIN.
  //
  // Ele já teve um próprio, e conviver com o PIN do CRM significava a mesma
  // pessoa com dois segredos de seis dígitos, dois contadores de tentativa e
  // duas telas de troca — trocar um deixava o outro valendo, que é o oposto
  // do que um PIN promete.
  //
  // A rota fica de pé, em vez de sumir, para versões antigas da extensão
  // receberem uma explicação em vez de um 404 mudo.
  requireAdmin(ctx);
  throw new HttpError(
    410,
    'O Authenticator usa o seu PIN de segurança do CRM. Cadastre ou troque em Meu Perfil → Segurança.',
  );
}


/**
 * BREAK-GLASS. A ordem das conferências é a própria política:
 * sessão → conta ativa → administrador → motivo → rate limit → escada do PIN →
 * PIN → step-up → só então decifrar. Cada saída é auditada.
 */
async function handleAdminSessions(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  if (!adminCan(actor.isActive, actor.isAdmin, 'list_sessions')) {
    throw new HttpError(403, 'Área restrita a administradores.');
  }

  const query = (ctx.url.searchParams.get('q') ?? '').trim();
  // Sessão revogada some da lista por padrão: o que interessa ao painel é o
  // que ainda ABRE o cofre agora.
  const includeRevoked = ctx.url.searchParams.get('include_revoked') === '1';

  let builder = ctx.db
    .from('totp_sessions')
    // Não existe `expires_at` nesta tabela: o que define até quando a sessão
    // vive é o refresh, porque é ele que ressuscita o access de 15 minutos.
    .select('id, user_id, kind, device_name, device_id, created_at, last_used_at, refresh_expires_at, revoked_at, revoked_reason')
    .order('last_used_at', { ascending: false })
    .limit(300);

  if (!includeRevoked) builder = builder.is('revoked_at', null);

  const { data, error } = await builder;
  if (error) throw new HttpError(500, 'Não foi possível listar os dispositivos.', error.message);

  const rows = data ?? [];
  const userIds = [...new Set(rows.map((row) => row.user_id as string))];
  const { data: profiles } = userIds.length
    ? await ctx.db.from('profiles').select('user_id, name, email, is_active').in('user_id', userIds)
    : { data: [] as never[] };
  const perfil = new Map((profiles ?? []).map((row) => [row.user_id as string, row]));

  // O filtro é por PESSOA, e roda aqui em vez de virar `or` no PostgREST: o
  // nome mora noutra tabela, e `or` sobre join foi exatamente o que já quebrou
  // a busca deste cofre uma vez.
  const alvo = query ? foldForSearch(query) : '';
  const visiveis = rows.filter((row) => {
    if (!alvo) return true;
    const dono = perfil.get(row.user_id as string);
    return [dono?.name, dono?.email, row.device_name]
      .filter(Boolean)
      .some((campo) => foldForSearch(String(campo)).includes(alvo));
  });

  const agora = Date.now();
  await writeAudit(ctx, {
    event_type: 'ADMIN_SESSIONS_LISTED',
    metadata_safe: { count: visiveis.length, include_revoked: includeRevoked, query: Boolean(query) },
  });

  return json(ctx.origin, {
    sessions: visiveis.map((row) => {
      const dono = perfil.get(row.user_id as string);
      return {
        id: row.id,
        user_id: row.user_id,
        user_name: dono?.name ?? null,
        user_email: dono?.email ?? null,
        // Quem já foi desligado no CRM continua com a linha de sessão de pé até
        // alguém derrubá-la: mostrar isso é o ponto da tela.
        user_is_active: dono?.is_active === true,
        kind: row.kind,
        device_name: row.device_name,
        created_at: row.created_at,
        last_used_at: row.last_used_at,
        expires_at: row.refresh_expires_at,
        revoked_at: row.revoked_at,
        revoked_reason: row.revoked_reason,
        is_expired: row.refresh_expires_at ? new Date(row.refresh_expires_at as string).getTime() <= agora : false,
        is_current: row.id === actor.sessionId,
      };
    }),
  });
}

async function handleAdminTransfer(ctx: Ctx): Promise<Response> {
  const actor = requireActor(ctx);
  if (!adminCan(actor.isActive, actor.isAdmin, 'transfer_ownership')) {
    throw new HttpError(403, 'Área restrita a administradores.');
  }

  const credentialId = String(ctx.body.credential_id ?? '').trim();
  const newOwner = String(ctx.body.new_owner_user_id ?? '').trim();
  const reason = String(ctx.body.reason ?? '').trim();
  const pin = String(ctx.body.pin ?? '');

  if (reason.length < 15) {
    throw new HttpError(400, 'Descreva o motivo da transferência em ao menos 15 caracteres.');
  }

  // A recusa mais importante do arquivo, e ela vem ANTES do PIN: transferir
  // para si mesmo é virar dono, e dono exporta segredo. Quem precisa do
  // segredo usa o break-glass, que é o caminho que já audita isso como tal.
  if (!adminMayReceiveOwnership(actor.userId, newOwner)) {
    await writeAudit(ctx, {
      event_type: 'ADMIN_TRANSFER_FAILED',
      credential_id: credentialId || null,
      reason,
      metadata_safe: { why: 'self_transfer_blocked' },
    });
    throw new HttpError(
      403,
      'Um administrador não pode transferir uma chave para si mesmo. Para ver o segredo, use a recuperação de emergência.',
    );
  }

  await enforce(ctx, 'totp-admin-transfer', [
    { bucketType: 'identity', value: actor.userId, limit: 30, windowSeconds: 3600, blockSeconds: 1800 },
    { bucketType: 'ip', limit: 60, windowSeconds: 3600, blockSeconds: 1800 },
  ]);

  const { data: credential, error } = await ctx.db
    .from('totp_credentials')
    .select(METADATA_COLUMNS)
    .eq('id', credentialId)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Não foi possível abrir a credencial.', error.message);
  if (!credential) throw new HttpError(404, 'Credencial não encontrada.');

  const row = credential as unknown as CredentialRow;
  if (row.status === 'deleted') throw new HttpError(409, 'Esta chave está na lixeira.');

  const previousOwner = row.owner_user_id;
  if (newOwner === previousOwner) throw new HttpError(400, 'Escolha outro usuário.');

  const destino = await loadProfile(ctx.db, newOwner);
  if (!destino || destino.is_active !== true) throw new HttpError(400, 'Usuário de destino inválido.');

  const falhar = (why: string) =>
    writeAudit(ctx, {
      event_type: 'ADMIN_TRANSFER_FAILED',
      credential_id: row.id,
      target_user_id: newOwner,
      reason,
      metadata_safe: { why, previous_owner: previousOwner },
    });

  await writeAuditStrict(ctx, {
    event_type: 'ADMIN_TRANSFER_REQUESTED',
    credential_id: row.id,
    target_user_id: newOwner,
    reason,
    metadata_safe: { previous_owner: previousOwner },
  });

  await requireAdminPin(ctx, actor, pin, falhar);

  // Mesma função transacional, com uma diferença de política: aqui o dono
  // antigo NÃO herda MANAGE. A transferência administrativa costuma existir
  // justamente porque ele saiu do escritório — devolver acesso a ele seria
  // desfazer o motivo da operação.
  const { data: transferiu, error: updateError } = await ctx.db.rpc('totp_transfer_ownership', {
    p_credential_id: row.id,
    p_previous_owner: previousOwner,
    p_new_owner: newOwner,
    p_actor: actor.userId,
    p_keep_previous_as_manage: false,
  });
  if (updateError) throw new HttpError(500, 'Não foi possível transferir a chave.', updateError.message);
  if (transferiu !== true) {
    await falhar('owner_changed');
    throw new HttpError(409, 'A propriedade mudou enquanto você confirmava. Recarregue e tente de novo.');
  }

  await writeAuditStrict(ctx, {
    event_type: 'ADMIN_TRANSFER_COMPLETED',
    credential_id: row.id,
    target_user_id: newOwner,
    reason,
    metadata_safe: {
      previous_owner: previousOwner,
      new_owner: newOwner,
      credential_name: row.name,
      previous_owner_kept: 'none',
    },
  });

  await notifyUser(ctx, {
    userId: newOwner,
    type: 'totp_transferred',
    title: 'Uma chave passou a ser sua',
    message: `A administração transferiu "${row.name}" para você. Como dono, você pode compartilhar e exportar.`,
    metadata: { credential_id: row.id, credential_name: row.name, by_admin: true },
  });

  // O dono antigo perdeu a chave por decisão administrativa e fica sem NADA
  // (nem MANAGE). Não avisar seria deixá-lo descobrir sozinho, na hora errada.
  await notifyUser(ctx, {
    userId: previousOwner,
    type: 'totp_revoked',
    title: 'Uma chave sua mudou de dono',
    message: `"${row.name}" foi transferida pela administração e não está mais no seu Authenticator.`,
    metadata: { credential_id: row.id, credential_name: row.name, new_owner: newOwner, by_admin: true },
  });

  await consumeStepUp(ctx, actor);
  return json(ctx.origin, { ok: true });
}

async function handleAdminRecover(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx);

  const credentialId = String(ctx.body.credential_id ?? '').trim();
  const reason = String(ctx.body.reason ?? '').trim();
  const pin = String(ctx.body.pin ?? '');

  if (reason.length < 15) {
    throw new HttpError(400, 'Descreva o motivo da recuperação em ao menos 15 caracteres.');
  }

  // Teto de abuso, não a trava principal: a escada progressiva do PIN é que
  // freia a tentativa às cegas. Com 5/hora aqui, o rate limit disparava ANTES
  // da 5ª tentativa errada e a escada nunca chegava a existir — e, pior, um
  // administrador legítimo recuperando 5 chaves numa migração ficava uma hora
  // de fora.
  await enforce(ctx, 'totp-admin-recover', [
    { bucketType: 'identity', value: actor.userId, limit: 30, windowSeconds: 3600, blockSeconds: 1800 },
    { bucketType: 'ip', limit: 60, windowSeconds: 3600, blockSeconds: 1800 },
  ]);

  const { data: credential, error } = await ctx.db
    .from('totp_credentials')
    .select(CREDENTIAL_COLUMNS)
    .eq('id', credentialId)
    .maybeSingle();
  if (error) throw new HttpError(500, 'Não foi possível abrir a credencial.', error.message);
  if (!credential) throw new HttpError(404, 'Credencial não encontrada.');

  const row = credential as unknown as CredentialRow;

  // Chave na lixeira não volta pelo break-glass. Recuperar segredo de algo que
  // foi EXCLUÍDO é restauração, não emergência — e restauração precisa de uma
  // decisão explícita e auditada de quem administra, não do mesmo botão.
  if (row.status === 'deleted') {
    await failRecovery(ctx, row, reason, 'credential_deleted');
    throw new HttpError(
      409,
      'Esta chave está na lixeira. Restaure-a antes de recuperar o segredo.',
    );
  }

  // Fail-closed: o pedido tem de estar registrado ANTES de qualquer passo que
  // possa levar ao segredo. Se a auditoria não grava, a recuperação nem começa.
  await writeAuditStrict(ctx, {
    event_type: 'ADMIN_RECOVERY_REQUESTED',
    credential_id: row.id,
    target_user_id: row.owner_user_id,
    reason,
  });

  await requireAdminPin(ctx, actor, pin, (why) => failRecovery(ctx, row, reason, why));

  const secret = await openSecret(keyring(), sealedFrom(row));
  const entry: ParsedTotpEntry = {
    name: row.name,
    issuer: row.issuer,
    accountLabel: row.account_label,
    secret,
    algorithm: row.algorithm,
    digits: row.digits,
    period: row.period,
  };

  // Estritamente antes do `return`: se este registro falhar, o segredo já
  // decifrado morre aqui dentro em vez de sair sem deixar rastro.
  await writeAuditStrict(ctx, {
    event_type: 'ADMIN_RECOVERY_COMPLETED',
    credential_id: row.id,
    target_user_id: row.owner_user_id,
    reason,
    metadata_safe: { credential_name: row.name, owner_user_id: row.owner_user_id },
  });

  await consumeStepUp(ctx, actor);

  return json(ctx.origin, {
    secret,
    uri: buildOtpauthUri(entry),
    name: row.name,
    owner_user_id: row.owner_user_id,
    // A interface usa isto para lembrar que o segredo é temporário na tela.
    display_seconds: 120,
  });
}


async function failRecovery(ctx: Ctx, row: CredentialRow, reason: string, why: string): Promise<void> {
  await writeAudit(ctx, {
    event_type: 'ADMIN_RECOVERY_FAILED',
    credential_id: row.id,
    target_user_id: row.owner_user_id,
    reason,
    metadata_safe: { why },
  });
}

/**
 * O portão administrativo: PIN próprio do cofre + reautenticação recente.
 *
 * Vive numa função só porque agora são DOIS os caminhos que precisam dele — a
 * recuperação break-glass e a transferência de propriedade. Duas cópias desta
 * escada seria pedir para uma delas envelhecer sem a outra.
 *
 * `onFail` recebe o motivo para o chamador auditar com o alvo certo; a falha
 * também precisa deixar rastro, não só o sucesso.
 */
async function requireAdminPin(
  ctx: Ctx,
  actor: Actor,
  pin: string,
  onFail: (why: string) => Promise<void>,
): Promise<void> {
  // O PIN é o DO SISTEMA (`user_security_pins`), o mesmo que a pessoa cadastra
  // em Meu Perfil → Segurança e usa no resto do CRM. O cofre já teve um PIN
  // próprio; dois PINs para a mesma pessoa é promessa quebrada esperando
  // acontecer — troca-se um e o outro continua valendo.
  //
  // A conferência mora numa função do banco porque no caminho da EXTENSÃO não
  // existe `auth.uid()`: a sessão é token opaco nosso. `actor.userId` vem da
  // sessão já validada, NUNCA do corpo do pedido.
  const { data, error } = await ctx.db.rpc('totp_verify_security_pin', {
    p_user_id: actor.userId,
    p_pin: pin,
    p_action: 'totp_vault',
  });

  if (error) {
    await onFail('pin_check_failed');
    throw new HttpError(500, 'Não foi possível conferir o PIN.', error.message);
  }

  const resultado = (data ?? {}) as { ok?: boolean; error?: string; locked_until?: string; attempts_left?: number };

  if (resultado.ok !== true) {
    if (resultado.error === 'no_pin') {
      await onFail('pin_not_configured');
      throw new HttpError(
        400,
        'Você ainda não tem PIN de segurança. Cadastre em Meu Perfil → Segurança, no CRM.',
      );
    }

    if (resultado.error === 'locked') {
      await onFail('pin_locked');
      const restamMs = resultado.locked_until
        ? new Date(resultado.locked_until).getTime() - Date.now()
        : 15 * 60_000;
      throw new HttpError(429, `PIN bloqueado. Tente em ${Math.max(1, Math.ceil(restamMs / 60_000))} min.`);
    }

    await onFail('wrong_pin');
    const restam = resultado.attempts_left;
    throw new HttpError(
      401,
      typeof restam === 'number'
        ? `PIN incorreto. Restam ${restam} tentativas.`
        : 'PIN incorreto.',
    );
  }

  // O PIN sozinho não basta: exige-se também reautenticação recente.
  try {
    await requireStepUp(ctx, actor, ctx.body.step_up_token);
  } catch (stepUpError) {
    await onFail('step_up_missing');
    throw stepUpError;
  }
}

/** Rotação: reembrulha os DEKs sob a versão ativa, em lotes. */
async function handleAdminRewrap(ctx: Ctx): Promise<Response> {
  const actor = requireAdmin(ctx);
  await requireStepUp(ctx, actor, ctx.body.step_up_token);

  const target = keyring().activeVersion;
  const batch = Math.min(Number(ctx.body.batch ?? 50), 200);

  const { data, error } = await ctx.db
    .from('totp_credentials')
    .select(CREDENTIAL_COLUMNS)
    .neq('status', 'deleted')
    .neq('key_version', target)
    .limit(batch);
  if (error) throw new HttpError(500, 'Não foi possível listar as chaves a rotacionar.', error.message);

  let done = 0;
  for (const raw of (data ?? []) as unknown as CredentialRow[]) {
    try {
      const rewrapped = await rewrapDek(keyring(), sealedFrom(raw), target);
      await ctx.db
        .from('totp_credentials')
        .update({
          wrapped_dek: bytesToPgHex(rewrapped.wrappedDek),
          dek_iv: bytesToPgHex(rewrapped.dekIv),
          key_version: rewrapped.keyVersion,
        })
        .eq('id', raw.id)
        .eq('key_version', raw.key_version);
      done += 1;
    } catch (rewrapError) {
      safeError(SCOPE, `falha ao rotacionar a credencial ${raw.id}`, rewrapError);
    }
  }

  const { count: remaining } = await ctx.db
    .from('totp_credentials')
    .select('id', { count: 'exact', head: true })
    .neq('status', 'deleted')
    .neq('key_version', target);

  await writeAudit(ctx, {
    event_type: 'KEY_ROTATION_BATCH',
    metadata_safe: { rewrapped: done, remaining: remaining ?? 0, target_version: target },
  });

  await consumeStepUp(ctx, actor);
  return json(ctx.origin, { rewrapped: done, remaining: remaining ?? 0, target_version: target });
}

// ── busca de usuários do CRM ────────────────────────────────────────────────

async function handleUserSearch(ctx: Ctx): Promise<Response> {
  requireActor(ctx);
  const query = (ctx.url.searchParams.get('q') ?? '').trim();
  if (query.length < 2) return json(ctx.origin, { users: [] });

  const { data, error } = await ctx.db
    .from('profiles')
    .select('user_id, name, email, role, avatar_url')
    .eq('is_active', true)
    .or(orIlike(['name', 'email'], query))
    .order('name')
    .limit(20);

  if (error) throw new HttpError(500, 'Não foi possível buscar usuários.', error.message);
  return json(ctx.origin, { users: data ?? [] });
}

// ============================================================================
// ROTEADOR
// ============================================================================

async function route(ctx: Ctx): Promise<Response> {
  const [first, second, third, fourth] = ctx.path;
  const method = ctx.method;

  if (first === 'health' && method === 'GET') {
    // Prova que o módulo carregou e as chaves estão no lugar, sem revelar nada.
    return json(ctx.origin, { ok: true, key_versions: keyring().versions().length });
  }

  if (first === 'auth') {
    if (second === 'login' && method === 'POST') return handleLogin(ctx);
    if (second === 'refresh' && method === 'POST') return handleRefresh(ctx);
    if (second === 'logout' && method === 'POST') return handleLogout(ctx);
    if (second === 'step-up' && method === 'POST') return handleStepUp(ctx);
    if (second === 'unlock' && method === 'POST') return handleUnlock(ctx);
    if (second === 'lock' && method === 'POST') return handleLock(ctx);
    if (second === 'unlock' && method === 'GET') return handleUnlockStatus(ctx);
    if (second === 'me' && method === 'GET') return handleMe(ctx);
    if (second === 'sessions' && method === 'GET') return handleListSessions(ctx);
    if (second === 'sessions' && third && method === 'DELETE') return handleRevokeSession(ctx, third);
  }

  if (first === 'credentials') {
    if (!second && method === 'GET') return handleListCredentials(ctx);
    if (!second && method === 'POST') return handleCreateCredential(ctx);

    if (second) {
      if (!third && method === 'GET') return handleCredentialDetail(ctx, second);
      if (!third && method === 'PATCH') return handleUpdateCredential(ctx, second);
      if (!third && method === 'DELETE') return handleDeleteCredential(ctx, second);
      if (third === 'code' && method === 'GET') return handleCode(ctx, second);
      if (third === 'favorite' && method === 'POST') return handleFavorite(ctx, second);
      if (third === 'transfer' && method === 'POST') return handleTransfer(ctx, second);
      if (third === 'export' && method === 'POST') return handleExport(ctx, second);
      if (third === 'permissions' && !fourth && method === 'GET') return handleListPermissions(ctx, second);
      if (third === 'permissions' && !fourth && method === 'POST') return handleGrantPermission(ctx, second);
      if (third === 'permissions' && fourth && method === 'DELETE') return handleRevokePermission(ctx, second, fourth);
    }
  }

  if (first === 'codes' && (method === 'GET' || method === 'POST')) return handleCodes(ctx);
  if (first === 'shares' && method === 'GET') return handleListShares(ctx);
  if (first === 'permissions' && second === 'bulk' && method === 'POST') return handleGrantPermissionsBulk(ctx);
  if (first === 'import' && method === 'POST') return handleImport(ctx);
  if (first === 'users' && second === 'search' && method === 'GET') return handleUserSearch(ctx);

  if (first === 'admin') {
    if (second === 'credentials' && method === 'GET') return handleAdminCredentials(ctx);
    if (second === 'audit' && method === 'GET') return handleAdminAudit(ctx);
    if (second === 'security' && method === 'GET') return handleAdminSecurity(ctx);
    if (second === 'security' && third === 'pin' && method === 'POST') return handleAdminSetPin(ctx);
    if (second === 'sessions' && !third && method === 'GET') return handleAdminSessions(ctx);
    if (second === 'transfer' && method === 'POST') return handleAdminTransfer(ctx);
    if (second === 'recover' && method === 'POST') return handleAdminRecover(ctx);
    if (second === 'rewrap' && method === 'POST') return handleAdminRewrap(ctx);
  }

  throw new HttpError(404, 'Recurso não encontrado.');
}

async function handleCredentialDetail(ctx: Ctx, credentialId: string): Promise<Response> {
  const actor = requireActor(ctx);
  const { row, acl, role } = await loadAuthorized(ctx, actor, credentialId, 'read_metadata', METADATA_COLUMNS);

  return json(ctx.origin, {
    credential: {
      id: row.id,
      name: row.name,
      issuer: row.issuer,
      account_label: row.account_label,
      algorithm: row.algorithm,
      digits: row.digits,
      period: row.period,
      status: row.status,
      owner_user_id: row.owner_user_id,
      is_owner: row.owner_user_id === actor.userId,
      role,
      can_export: can(acl, 'export_secret'),
      can_manage: can(acl, 'share'),
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
  });
}

// ============================================================================
// ENTRADA
// ============================================================================

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Origem desconhecida é barrada ANTES de qualquer processamento. Não existe
  // `Access-Control-Allow-Origin: *` num endpoint autenticado.
  if (origin && !isOriginAllowed(origin)) {
    return new Response(JSON.stringify({ error: 'Origem não autorizada.' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments[0] === 'functions' && segments[1] === 'v1') segments.splice(0, 2);
  if (segments[0] === 'totp-vault') segments.shift();

  const db = serviceClient();
  const ctx: Ctx = {
    req,
    db,
    origin,
    ip: clientIp(req),
    userAgent: req.headers.get('user-agent'),
    path: segments,
    method: req.method,
    url,
    body: {},
    actor: null,
  };

  try {
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'DELETE') {
      const contentType = req.headers.get('content-type') ?? '';
      const raw = await req.text();
      if (raw.length > MAX_BODY_BYTES) throw new HttpError(413, 'Conteúdo grande demais.');
      if (raw.trim()) {
        if (!contentType.includes('application/json')) {
          throw new HttpError(415, 'Envie o corpo como application/json.');
        }
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            ctx.body = parsed as Record<string, unknown>;
          }
        } catch (_) {
          throw new HttpError(400, 'Corpo da requisição inválido.');
        }
      }
    }

    const isPublic = ctx.path[0] === 'auth' && ['login', 'refresh'].includes(ctx.path[1] ?? '');
    const isHealth = ctx.path[0] === 'health';
    if (!isPublic && !isHealth) {
      ctx.actor = await resolveActor(ctx);
    }

    return await route(ctx);
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.internal) safeError(SCOPE, `${error.status} em /${ctx.path.join('/')}`, error.internal);
      return json(ctx.origin, { error: error.publicMessage }, error.status);
    }

    // Erro inesperado: o técnico fica no servidor, sanitizado. O cliente
    // recebe uma frase que não descreve a criptografia nem a estrutura.
    safeError(SCOPE, `falha em ${ctx.method} /${ctx.path.join('/')}`, error);
    return json(ctx.origin, { error: 'Não foi possível concluir a operação.' }, 500);
  }
});
