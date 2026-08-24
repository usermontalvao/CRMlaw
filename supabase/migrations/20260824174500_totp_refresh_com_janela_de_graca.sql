-- A rotação de refresh token não tinha como distinguir ROUBO de RESPOSTA
-- PERDIDA, e tratava os dois como roubo.
--
-- O caso benigno é banal: a extensão pede a renovação, o servidor rotaciona e
-- grava, e a resposta se perde no caminho (rede caiu, service worker do MV3 foi
-- morto no meio, notebook dormiu). A extensão continua com o token ANTIGO. No
-- uso seguinte ele bate em `previous_refresh_hash` e a sessão inteira era
-- encerrada — o usuário via "entre novamente" sem nada de errado ter
-- acontecido. Com o alarme girando token a cada 10 minutos, eram ~144 rotações
-- por dia: perder uma era questão de horas.
--
-- Esta coluna guarda QUANDO a rotação aconteceu, para a Edge Function poder
-- perguntar "faz quanto tempo?". Token reapresentado poucos segundos depois da
-- própria rotação é resposta perdida; reapresentado depois da janela continua
-- sendo tratado como roubo, e a sessão cai como antes.

alter table public.totp_sessions
  add column if not exists refresh_rotated_at timestamptz;

comment on column public.totp_sessions.refresh_rotated_at is
  'Quando o refresh token foi rotacionado pela última vez. Sustenta a janela de graça que separa resposta perdida de reuso malicioso.';

-- Sessões que já existem nascem com a marca de agora: sem isto, o primeiro
-- reuso legítimo delas cairia na regra antiga.
update public.totp_sessions
   set refresh_rotated_at = coalesce(refresh_rotated_at, last_used_at, created_at)
 where refresh_rotated_at is null;
