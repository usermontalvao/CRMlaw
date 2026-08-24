-- ============================================================================
-- TOTP Vault — o cofre de códigos 2FA do escritório
--
-- Isolamento lógico forte: NENHUMA destas tabelas é acessível pela Data API.
-- RLS fica ligada e SEM POLICY para `authenticated`/`anon`, de propósito — a
-- única porta é a Edge Function `totp-vault`, que roda com service role e
-- refaz TODA a autorização a cada chamada. Assim não existe caminho em que a
-- interface seja a barreira.
--
-- O segredo TOTP nunca existe em texto puro aqui: guarda-se o ciphertext
-- AES-256-GCM, o IV, o DEK embrulhado (envelope encryption) e a versão da
-- chave mestra. A chave mestra mora só em variável de ambiente da função.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Credenciais
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.totp_credentials (
  id                 uuid primary key default gen_random_uuid(),

  -- RESTRICT de propósito: apagar um usuário que ainda é dono de chave tem de
  -- falhar. Primeiro se transfere a propriedade (POST /credentials/:id/transfer),
  -- depois se apaga a conta — nunca o contrário.
  owner_user_id      uuid not null references auth.users(id) on delete restrict,

  name               text not null check (length(btrim(name)) between 1 and 120),
  issuer             text check (issuer is null or length(issuer) <= 120),
  account_label      text check (account_label is null or length(account_label) <= 200),

  algorithm          text     not null default 'SHA1'
                       check (algorithm in ('SHA1', 'SHA256', 'SHA512')),
  digits             smallint not null default 6  check (digits in (6, 8)),
  period             smallint not null default 30 check (period between 10 and 300),

  -- ── envelope encryption ──────────────────────────────────────────────────
  secret_ciphertext  bytea    not null,   -- AES-256-GCM(secret, DEK)  [tag embutida]
  secret_iv          bytea    not null,   -- 12 bytes
  wrapped_dek        bytea    not null,   -- AES-256-GCM(DEK, KEK)     [tag embutida]
  dek_iv             bytea    not null,   -- 12 bytes
  key_version        integer  not null,   -- qual chave mestra embrulhou este DEK
  crypto_version     smallint not null default 1,

  -- HMAC-SHA256 do segredo com pepper derivado da chave mestra. Serve só para
  -- detectar duplicidade na importação. Sem a chave mestra não dá para montar
  -- dicionário — por isso não é um sha256 simples do segredo.
  secret_fingerprint text     not null,

  status             text not null default 'active'
                       check (status in ('active', 'archived', 'deleted')),

  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  deleted_by         uuid references auth.users(id) on delete set null,
  deleted_reason     text
);

comment on table public.totp_credentials is
  'Cofre TOTP. O segredo só existe cifrado (AES-256-GCM com DEK próprio por credencial). Acesso exclusivo pela Edge Function totp-vault.';
comment on column public.totp_credentials.secret_fingerprint is
  'HMAC-SHA256(segredo) com pepper derivado da chave mestra — só para detectar duplicidade na importação.';

create index if not exists totp_credentials_owner_idx
  on public.totp_credentials (owner_user_id) where status <> 'deleted';
create index if not exists totp_credentials_status_idx
  on public.totp_credentials (status);
create index if not exists totp_credentials_fingerprint_idx
  on public.totp_credentials (secret_fingerprint) where status <> 'deleted';
create index if not exists totp_credentials_key_version_idx
  on public.totp_credentials (key_version) where status <> 'deleted';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. ACL por credencial
--
-- Uma linha por (credencial, usuário). O nível é cumulativo:
--   USE (1)  → ver o nome e obter o CÓDIGO
--   MANAGE(2)→ USE + renomear, compartilhar, revogar compartilhamento
--   EXPORT(3)→ MANAGE + exportar o SEGREDO (com step-up)
-- O dono não tem linha aqui: a propriedade já é o nível máximo.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.totp_permissions (
  id            uuid primary key default gen_random_uuid(),
  credential_id uuid not null references public.totp_credentials(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  permission    text not null check (permission in ('USE', 'MANAGE', 'EXPORT')),
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint totp_permissions_unique unique (credential_id, user_id)
);

comment on table public.totp_permissions is
  'ACL por credencial. Níveis cumulativos: USE < MANAGE < EXPORT. O dono não aparece aqui.';

create index if not exists totp_permissions_user_idx on public.totp_permissions (user_id);
create index if not exists totp_permissions_credential_idx on public.totp_permissions (credential_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Favoritos (preferência de quem usa, não permissão)
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.totp_favorites (
  user_id       uuid not null references auth.users(id) on delete cascade,
  credential_id uuid not null references public.totp_credentials(id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (user_id, credential_id)
);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Auditoria — append-only de verdade
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.totp_audit_logs (
  id             bigint generated always as identity primary key,
  event_type     text not null,
  actor_user_id  uuid,
  target_user_id uuid,
  -- sem FK: a linha de auditoria tem de sobreviver ao sumiço da credencial, e
  -- um ON DELETE SET NULL seria um UPDATE — que o gatilho abaixo proíbe.
  credential_id  uuid,
  ip             text,
  user_agent     text,
  session_id     uuid,
  reason         text,
  metadata_safe  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

comment on table public.totp_audit_logs is
  'Auditoria append-only do cofre. NUNCA recebe segredo, código TOTP, PIN, senha ou token.';

create index if not exists totp_audit_created_idx    on public.totp_audit_logs (created_at desc);
create index if not exists totp_audit_actor_idx      on public.totp_audit_logs (actor_user_id, created_at desc);
create index if not exists totp_audit_credential_idx on public.totp_audit_logs (credential_id, created_at desc);
create index if not exists totp_audit_event_idx      on public.totp_audit_logs (event_type, created_at desc);

create or replace function public.totp_audit_is_append_only()
returns trigger
language plpgsql
as $fn$
begin
  raise exception 'totp_audit_logs é append-only: % não é permitido', tg_op
    using errcode = 'insufficient_privilege';
end;
$fn$;

drop trigger if exists totp_audit_no_update on public.totp_audit_logs;
create trigger totp_audit_no_update
  before update or delete on public.totp_audit_logs
  for each row execute function public.totp_audit_is_append_only();

-- ────────────────────────────────────────────────────────────────────────────
-- 5. PIN administrativo — por administrador, nunca compartilhado
--
-- O PIN é camada de AUTORIZAÇÃO privilegiada, não chave de criptografia:
-- ele não participa do envelope. Guarda-se só a derivação (PBKDF2-SHA512 com
-- salt individual, sobre um HMAC com pepper que mora em variável de ambiente).
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.totp_admin_security (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  pin_hash        text not null,
  pin_salt        text not null,
  kdf             text not null default 'pbkdf2-sha512-600k+hmac-pepper.v1',
  pin_set_at      timestamptz not null default now(),
  pin_set_by      uuid references auth.users(id) on delete set null,
  failed_attempts integer not null default 0,
  lock_round      integer not null default 0,
  locked_until    timestamptz,
  last_used_at    timestamptz,
  updated_at      timestamptz not null default now()
);

comment on table public.totp_admin_security is
  'PIN de recuperação (break-glass) por administrador. Só a derivação é guardada; o PIN nunca sai por API.';

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Sessões da extensão
--
-- Tokens opacos, guardados só como SHA-256. O access é curto; o refresh gira a
-- cada uso e a geração anterior fica registrada para detectar reutilização
-- (sinal de token roubado → derruba a sessão inteira).
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.totp_sessions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  device_id             text not null,
  device_name           text,
  user_agent            text,
  ip                    text,

  access_token_hash     text,
  access_expires_at     timestamptz,

  refresh_token_hash    text not null,
  previous_refresh_hash text,
  refresh_expires_at    timestamptz not null,
  refresh_generation    integer not null default 0,

  step_up_token_hash    text,
  step_up_expires_at    timestamptz,

  created_at            timestamptz not null default now(),
  last_used_at          timestamptz not null default now(),
  revoked_at            timestamptz,
  revoked_by            uuid references auth.users(id) on delete set null,
  revoked_reason        text
);

comment on table public.totp_sessions is
  'Sessões da extensão. Só o SHA-256 do token é guardado; revogar aqui derruba o dispositivo na chamada seguinte.';

create index if not exists totp_sessions_user_idx
  on public.totp_sessions (user_id, last_used_at desc);
create unique index if not exists totp_sessions_access_hash_idx
  on public.totp_sessions (access_token_hash) where access_token_hash is not null;
create unique index if not exists totp_sessions_refresh_hash_idx
  on public.totp_sessions (refresh_token_hash);
create unique index if not exists totp_sessions_active_device_idx
  on public.totp_sessions (user_id, device_id) where revoked_at is null;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. updated_at
-- ────────────────────────────────────────────────────────────────────────────

create or replace function public.totp_touch_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists totp_credentials_touch on public.totp_credentials;
create trigger totp_credentials_touch before update on public.totp_credentials
  for each row execute function public.totp_touch_updated_at();

drop trigger if exists totp_permissions_touch on public.totp_permissions;
create trigger totp_permissions_touch before update on public.totp_permissions
  for each row execute function public.totp_touch_updated_at();

drop trigger if exists totp_admin_security_touch on public.totp_admin_security;
create trigger totp_admin_security_touch before update on public.totp_admin_security
  for each row execute function public.totp_touch_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Portas fechadas
--
-- RLS ligada e nenhuma policy: `anon` e `authenticated` não leem nem escrevem
-- nada por PostgREST. Só a service role (que ignora RLS) entra, e ela só é
-- usada de dentro da Edge Function, depois da autorização.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.totp_credentials    enable row level security;
alter table public.totp_permissions    enable row level security;
alter table public.totp_favorites      enable row level security;
alter table public.totp_audit_logs     enable row level security;
alter table public.totp_admin_security enable row level security;
alter table public.totp_sessions       enable row level security;

alter table public.totp_credentials    force row level security;
alter table public.totp_permissions    force row level security;
alter table public.totp_favorites      force row level security;
alter table public.totp_audit_logs     force row level security;
alter table public.totp_admin_security force row level security;
alter table public.totp_sessions       force row level security;

revoke all on public.totp_credentials    from anon, authenticated;
revoke all on public.totp_permissions    from anon, authenticated;
revoke all on public.totp_favorites      from anon, authenticated;
revoke all on public.totp_audit_logs     from anon, authenticated;
revoke all on public.totp_admin_security from anon, authenticated;
revoke all on public.totp_sessions       from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. O módulo entra na matriz de permissões
--
-- 'authenticator' passa a ser um módulo como os outros: quem pode ABRIR a área
-- administrativa no CRM sai daqui. Isso NÃO dá acesso a segredo nenhum — ver o
-- cofre e recuperar uma chave são coisas diferentes (break-glass com PIN).
-- ────────────────────────────────────────────────────────────────────────────

insert into public.role_permissions (role, module, can_view, can_create, can_edit, can_delete)
select rp.role, 'authenticator',
       lower(rp.role) in ('administrador', 'admin', 'socio'),
       lower(rp.role) in ('administrador', 'admin', 'socio'),
       lower(rp.role) in ('administrador', 'admin', 'socio'),
       lower(rp.role) in ('administrador', 'admin', 'socio')
  from (select distinct role from public.role_permissions) rp
on conflict (role, module) do nothing;

commit;
