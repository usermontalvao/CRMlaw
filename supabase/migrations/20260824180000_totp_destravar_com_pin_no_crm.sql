-- O CRM ganhou um atalho para os códigos 2FA, na barra do topo — e ele pede o
-- PIN, destravando por 2 horas.
--
-- A trava é de SERVIDOR, não de tela. Pedir o PIN só no React seria teatro:
-- bastaria chamar `/codes` pelo DevTools com o mesmo JWT. Estas colunas
-- guardam o destravamento, amarrado à sessão, que a Edge Function exige antes
-- de gerar código para sessão do tipo `web`.
--
-- Por que só a sessão web: o navegador do CRM costuma ficar aberto na mesa, e
-- quem passa por ali herda a sessão. A extensão é outra história — vive num
-- dispositivo específico, e lá o PIN é cobrado UMA vez, no login. Mesma chave,
-- riscos diferentes, travas diferentes.
--
-- `pin_unlock_hash` nasceu para um token que a aba carregaria e acabou não
-- sendo usada: com 2 horas, o destravamento é propriedade da SESSÃO (o JWT já
-- diz quem é), o que sobrevive a um F5 e evita guardar qualquer coisa sensível
-- no navegador. A coluna fica para não quebrar quem já subiu a migration.

alter table public.totp_sessions
  add column if not exists pin_unlock_hash       text,
  add column if not exists pin_unlock_expires_at timestamptz;

comment on column public.totp_sessions.pin_unlock_hash is
  'Reservada. O destravamento por PIN é validado pela expiração, não por token.';
comment on column public.totp_sessions.pin_unlock_expires_at is
  'Até quando esta sessão web pode gerar código sem pedir o PIN de novo (2 horas).';
