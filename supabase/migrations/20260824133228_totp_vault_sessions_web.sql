-- A sessão também vale para o CRM.
--
-- O step-up (reautenticação recente) precisa morar em algum lugar do servidor,
-- e criar uma tabela só para isso duplicaria o que `totp_sessions` já faz. O
-- CRM passa a ter a sua própria linha de sessão — autenticada pelo JWT do
-- Supabase, sem refresh próprio — e com isso a lista de dispositivos mostra
-- também "Chrome — CRM", que é exatamente o que a tela de sessões promete.

begin;

alter table public.totp_sessions
  add column if not exists kind text not null default 'extension';

alter table public.totp_sessions
  drop constraint if exists totp_sessions_kind_check;
alter table public.totp_sessions
  add constraint totp_sessions_kind_check check (kind in ('extension', 'web'));

-- A sessão do CRM não tem refresh próprio: quem renova é o GoTrue.
alter table public.totp_sessions
  alter column refresh_token_hash drop not null;
alter table public.totp_sessions
  alter column refresh_expires_at drop not null;

comment on column public.totp_sessions.kind is
  'extension = token opaco emitido por nós; web = sessão do CRM, autenticada pelo JWT do Supabase (a linha só guarda o step-up).';

commit;
