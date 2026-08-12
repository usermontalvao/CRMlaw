-- A reserva do aviso de ausência vira função no banco.
--
-- POR QUÊ: pelo PostgREST, um `update` com filtro `or=(col.is.null,col.lt.X)`
-- devolve 42703 — "column whatsapp_conversations.absence_sent_at does not
-- exist" — embora o MESMO filtro funcione num `select`. É o mesmo defeito que
-- já derrubou a trava do assistente de IA (ver `wa_ai_acquire_lock`, migration
-- 20260812150000).
--
-- O estrago aqui foi de cara para o cliente: o `evolution-webhook` recebia a
-- mensagem fora do expediente, tentava reservar o disparo, tomava 400 e saía
-- sem enviar nada. Entre 07 e 12/08/2026 isso passou despercebido porque um
-- remendo aplicado direto em produção (fallback no `whatsapp-scheduler`, que
-- nunca existiu no repositório) socorria cada falha um minuto depois. O deploy
-- do scheduler a partir do repositório apagou o remendo, e no mesmo dia um
-- cliente ficou sem resposta às 18h08.
--
-- Agora a condição inteira é um UPDATE só, dentro do banco: continua atômico
-- (quem gravar a marca venceu a disputa entre webhooks simultâneos) e passa a
-- usar o relógio do Postgres em vez do relógio de cada isolate.

create or replace function public.wa_absence_claim(
  p_conversation_id uuid,
  p_cooldown_hours integer default 12
) returns timestamptz
language sql
security definer
set search_path = public
as $$
  update whatsapp_conversations
     set absence_sent_at = now()
   where id = p_conversation_id
     and coalesce(is_blocked, false) = false
     and coalesce(absence_suppressed, false) = false
     and (
       absence_sent_at is null
       or absence_sent_at < now() - make_interval(hours => greatest(1, p_cooldown_hours))
     )
  returning absence_sent_at;
$$;

comment on function public.wa_absence_claim(uuid, integer) is
  'Reserva o aviso automático fora do horário. Devolve o instante gravado quando o disparo é desta chamada, ou NULL quando a conversa está bloqueada, suprimida ou ainda dentro do cooldown.';

-- Desfaz a reserva quando o envio falhou de verdade, sem apagar uma marca mais
-- nova que outro webhook tenha gravado no meio do caminho.
create or replace function public.wa_absence_release(
  p_conversation_id uuid,
  p_claimed_at timestamptz,
  p_previous timestamptz default null
) returns boolean
language sql
security definer
set search_path = public
as $$
  update whatsapp_conversations
     set absence_sent_at = p_previous
   where id = p_conversation_id
     and absence_sent_at = p_claimed_at
  returning true;
$$;

comment on function public.wa_absence_release(uuid, timestamptz, timestamptz) is
  'Devolve a reserva do aviso de ausência após falha confirmada de envio. Só mexe se a marca ainda for a desta chamada.';

-- Só o webhook usa. Ninguém do navegador precisa disto.
revoke all on function public.wa_absence_claim(uuid, integer) from public;
revoke all on function public.wa_absence_claim(uuid, integer) from anon;
revoke all on function public.wa_absence_claim(uuid, integer) from authenticated;
grant execute on function public.wa_absence_claim(uuid, integer) to service_role;

revoke all on function public.wa_absence_release(uuid, timestamptz, timestamptz) from public;
revoke all on function public.wa_absence_release(uuid, timestamptz, timestamptz) from anon;
revoke all on function public.wa_absence_release(uuid, timestamptz, timestamptz) from authenticated;
grant execute on function public.wa_absence_release(uuid, timestamptz, timestamptz) to service_role;
