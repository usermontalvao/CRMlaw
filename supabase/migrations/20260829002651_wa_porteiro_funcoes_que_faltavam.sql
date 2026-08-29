-- ── O porteiro do canal perguntava a uma função que não existia ─────────────
--
-- APLICADA EM PRODUÇÃO em 29/08/2026, durante uma queda: o módulo WhatsApp
-- parou de enviar, com 403 em toda mensagem.
--
-- A `evolution-send` deployada naquele dia conversa com o banco antes de deixar
-- qualquer mensagem sair: `wa_can_reply_conv` para responder ao cliente,
-- `wa_can_manage_conv` para mexer no atendimento. Nenhuma das duas existia
-- aqui — a migration que as cria (20260822090000) nunca foi aplicada por
-- inteiro, só em recortes.
--
-- E o porteiro trata erro como negativa (`if (error) return false`, em
-- `_shared/wa-guard.ts`), que é a leitura CORRETA para uma trava de segurança:
-- na dúvida, não deixa passar. Foi por isso que a falha não apareceu como erro
-- de banco em lugar nenhum — apareceu como "sem permissão", em todo mundo.
--
-- A lição, que vale para o próximo deploy: função de banco que uma Edge
-- Function chama é DEPENDÊNCIA DE DEPLOY dela. Subir a função sem subir a
-- migration derruba o módulo inteiro, em silêncio.
--
-- Esta migration cria SÓ o que falta para as duas existirem, copiado
-- literalmente de 20260822090000. Nada é derrubado, nenhuma policy é tocada,
-- nenhuma coluna é alterada. O resto daquela migration (as políticas de RLS, o
-- estado das transferências — que é o 400 em `whatsapp_transfers?status=`)
-- continua pendente e é assunto separado.

create or replace function public.wa_is_supervisor_of_channel(p_channel uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.is_office_staff() and (
    public.wa_is_admin()
    or (
      p_channel is not null
      and exists (
        select 1 from public.whatsapp_channel_members cm
         where cm.channel_id = p_channel
           and cm.user_id = auth.uid()
           and cm.role = 'supervisor'
      )
    )
  );
$$;

create or replace function public.wa_supervises_department(p_dept uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.is_office_staff() and (
    public.wa_is_admin()
    or (
      p_dept is not null
      and exists (
        select 1 from public.whatsapp_department_members dm
         where dm.department_id = p_dept
           and dm.user_id = auth.uid()
           and dm.role = 'supervisor'
      )
    )
  );
$$;

-- Colaborador temporário: acesso a UMA conversa, e que expira. A tabela nasce
-- vazia, então hoje ela não concede nada a ninguém — está aqui porque
-- `wa_can_reply_conv` a consulta.
create table if not exists public.whatsapp_conversation_collaborators (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  user_id         uuid not null,
  granted_by      uuid,
  granted_at      timestamptz not null default now(),
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid,
  reason          text,
  unique (conversation_id, user_id)
);

create index if not exists whatsapp_conversation_collaborators_user_idx
  on public.whatsapp_conversation_collaborators (user_id)
  where revoked_at is null;

comment on table public.whatsapp_conversation_collaborators is
  'Acesso explícito e temporário a UMA conversa. Não concede nada sobre o canal. Termina no encerramento, na expiração, na revogação ou numa nova transferência.';

alter table public.whatsapp_conversation_collaborators enable row level security;

create or replace function public.wa_collaborator_active(p_conv uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
      from public.whatsapp_conversation_collaborators col
      join public.whatsapp_conversations c on c.id = col.conversation_id
     where col.conversation_id = p_conv
       and col.user_id = p_user
       and col.revoked_at is null
       and (col.expires_at is null or col.expires_at > now())
       and c.status <> 'closed'
  );
$$;

-- Mexer no ATENDIMENTO (responsável, fila, encerramento, leitura).
create or replace function public.wa_can_manage_conv(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1 from public.whatsapp_conversations c
     where c.id = p_conv
       and public.is_office_staff()
       and (
         public.wa_is_admin()
         or c.assigned_user_id = auth.uid()
         or public.wa_is_supervisor_of_channel(c.instance_id)
         or public.wa_supervises_department(c.department_id)
         -- Conversa SEM dono é da fila: quem pode vê-la pode assumi-la.
         or (c.assigned_user_id is null
             and public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id))
       )
  );
$$;

-- Mandar mensagem para o cliente por esta conversa.
create or replace function public.wa_can_reply_conv(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.wa_can_manage_conv(p_conv)
      or public.wa_collaborator_active(p_conv, auth.uid());
$$;

comment on function public.wa_can_reply_conv(uuid) is
  'Pode mandar mensagem ao cliente por esta conversa. Ver não é responder: o supervisor em "apenas acompanhar" enxerga e não fala.';

grant execute on function public.wa_is_supervisor_of_channel(uuid) to authenticated;
grant execute on function public.wa_supervises_department(uuid) to authenticated;
grant execute on function public.wa_collaborator_active(uuid, uuid) to authenticated;
grant execute on function public.wa_can_manage_conv(uuid) to authenticated;
grant execute on function public.wa_can_reply_conv(uuid) to authenticated;
