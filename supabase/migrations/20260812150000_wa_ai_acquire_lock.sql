-- A trava do turno do Assistente de IA vira função no banco.
--
-- POR QUÊ: pelo PostgREST, um `update` com filtro `or=(col.is.null,col.lt.X)`
-- devolve 42703 — "column <tabela>.<col> does not exist" — embora o MESMO
-- filtro funcione num `select`. Comprovado em 12/08/2026 contra este projeto,
-- em duas tabelas diferentes.
--
-- O estrago era silencioso: `acquireLock` recebia 400, devolvia null, e o
-- agente concluía "outra execução em andamento" e desistia. Resultado: a IA
-- nunca respondia e não deixava nem log nem linha em whatsapp_ai_executions.
--
-- Aqui a condição vira um UPDATE só, dentro do banco: continua atômico (quem
-- gravar o próprio token venceu) e passa a usar o relógio do Postgres em vez do
-- relógio de cada isolate.

create or replace function public.wa_ai_acquire_lock(
  p_conversation_id uuid,
  p_token uuid,
  p_seconds integer default 120
) returns uuid
language sql
security definer
set search_path = public
as $$
  update whatsapp_ai_sessions
     set lock_token = p_token,
         locked_until = now() + make_interval(secs => greatest(1, p_seconds))
   where conversation_id = p_conversation_id
     and (locked_until is null or locked_until < now())
  returning lock_token;
$$;

comment on function public.wa_ai_acquire_lock(uuid, uuid, integer) is
  'Trava do turno do agente de IA. Devolve o token quando venceu a disputa, ou NULL quando outra execução já está com a conversa.';

-- Só o motor usa. Ninguém do navegador precisa disto.
revoke all on function public.wa_ai_acquire_lock(uuid, uuid, integer) from public;
revoke all on function public.wa_ai_acquire_lock(uuid, uuid, integer) from anon;
revoke all on function public.wa_ai_acquire_lock(uuid, uuid, integer) from authenticated;
grant execute on function public.wa_ai_acquire_lock(uuid, uuid, integer) to service_role;
