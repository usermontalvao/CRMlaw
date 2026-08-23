-- ============================================================================
-- WhatsApp — o NÚCLEO da autorização.
--
-- Esta migration não muda nenhuma tela. Ela troca a resposta de três perguntas
-- que o banco inteiro faz o tempo todo: quem é da casa, quem manda em qual
-- canal, e o que o passado ainda concede.
--
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
--
-- 1. HISTÓRICO VALIA COMO CRACHÁ, E O CRACHÁ ERA AUTOSSERVIÇO.
--
--    `wa_can_see_conv` abria a conversa para quem aparecesse em QUALQUER linha
--    de `whatsapp_transfers` dela — sem estado, sem prazo, para sempre. Uma
--    transferência de março continuava valendo em agosto, depois de a conversa
--    ter mudado de dono duas vezes.
--
--    `wa_can_see_channel` era pior: a mesma linha de transferência abria o
--    CANAL INTEIRO. Receber uma conversa emprestada por dez minutos dava, em
--    troca, a inbox permanente de um canal restrito.
--
--    E a policy de INSERT de `whatsapp_transfers` era só `is_office_staff()`.
--    Ou seja: o crachá não precisava ser concedido por ninguém. Bastava um
--    POST ao PostgREST —
--
--        insert into whatsapp_transfers (conversation_id, to_user_id)
--        values ('<uuid de qualquer conversa>', '<eu mesmo>');
--
--    — e as duas funções acima passavam a responder `true`. Nenhum id secreto
--    era necessário: `conversation_id` aparece em qualquer resposta da própria
--    inbox, e um uuid chutado também serve. Este é o furo mais grave do módulo
--    e ele não estava na lista de suspeitos.
--
-- 2. `is_office_staff()` QUERIA DIZER "TEM PERFIL", NÃO "TRABALHA AQUI".
--
--        SELECT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid());
--
--    Sem `is_active`. Desligar alguém no CRM não tirava nada: enquanto o JWT
--    dele valesse (e ele vale por semanas, com refresh), continuava lendo
--    conversa, mensagem, ligação e gravação. A função certa —
--    `is_active_office_staff()` — já existia, e só o broadcast a usava.
--
-- 3. NÃO EXISTIA SUPERVISOR.
--
--    `wa_is_supervisor()` era, na verdade, "é Administrador" — global, sem
--    escopo. Não havia como dizer "esta pessoa manda no canal do trabalhista e
--    em mais nada", que é o pedido inteiro do modelo de acesso.
--    `whatsapp_channel_members` tinha só `channel_id` e `user_id`.
--
-- 4. `wa_can_see_call` FALHAVA ABERTO.
--
--    O último ramo dizia: telefone que não bate com conversa nenhuma é visível
--    para todo o escritório. A intenção era não esconder a ligação para número
--    novo; o efeito é que bastava a conversa ainda não existir para a ligação
--    de um canal restrito aparecer para qualquer um.
--
-- 5. DAVA PARA ESCREVER DENTRO DO QUE NÃO SE PODE LER.
--
--    As policies de INSERT de `whatsapp_messages`, `whatsapp_internal_notes`,
--    `whatsapp_contact_blocks`, `whatsapp_scheduled_messages`,
--    `whatsapp_call_logs` e das tabelas de IA exigiam só `is_office_staff()`.
--    A leitura era recortada por canal; a escrita, não. Dava para plantar
--    mensagem, nota e agendamento em atendimento alheio.
--
--
-- ── O QUE ESTA MIGRATION FAZ ────────────────────────────────────────────────
--
--   · `is_office_staff()` passa a exigir `is_active`;
--   · nasce o supervisor COM ESCOPO (`role` em canal e em setor);
--   · nasce o colaborador temporário — acesso a UMA conversa, com prazo;
--   · `whatsapp_transfers` ganha estado (pending/accepted/rejected/cancelled/
--     expired) e deixa de aceitar escrita direta: só as RPCs escrevem;
--   · `wa_can_see_channel` e `wa_can_see_conv` param de ler histórico e passam
--     a ler apenas o que está VIGENTE;
--   · nascem as funções centrais de decisão (`wa_can_manage_conv`,
--     `wa_can_reply_conv`, `wa_can_transfer_conv`, `wa_can_accept_transfer`,
--     `wa_destination_can_access`);
--   · `wa_can_see_call` fecha o ramo do "não achei conversa";
--   · toda policy de escrita passa a exigir acesso à CONVERSA.
--
-- As RPCs de atendimento (assumir, transferir, aceitar…) são reescritas na
-- migration seguinte, que depende das funções criadas aqui.
--
--
-- ── POR QUE NÃO HÁ BACKFILL DE MEMBROS ─────────────────────────────────────
--
-- `whatsapp_channel_members` está VAZIA em produção, e a primeira leitura disso
-- foi: "então o acesso de quem não é administrador vem inteiramente dos
-- caminhos que esta migration corta, e cortar sem repor derruba a operação".
-- Foi por essa leitura que um backfill chegou a ser escrito aqui.
--
-- Os números desmentiram. No canal restrito, hoje:
--
--   · são 198 conversas;
--   · a auxiliar ativa enxerga UMA — e a enxerga por ser a responsável dela
--     (`assigned_user_id`), que é um caminho que esta migration PRESERVA. A
--     transferência que também a alcança é da mesma conversa;
--   · a advogada ativa enxerga ZERO;
--   · o administrador enxerga tudo, e continua enxergando.
--
-- Ou seja: ninguém perde nada com o corte. E inscrever a auxiliar como membro
-- do canal, para "não tirar o que ela já tinha", daria a ela as outras 197
-- conversas — seria ampliar o acesso usando a linguagem de preservá-lo, que é
-- a pior forma de ampliá-lo, porque ninguém revisa o que foi apresentado como
-- compatibilidade.
--
-- Então: nenhum membro é inscrito. Conceder o canal a alguém passa a ser um ato
-- deliberado, na tela de acesso do canal (ChannelAccessManager) ou pelo comando
-- abaixo, que fica AQUI SÓ COMO DOCUMENTAÇÃO — comentado de propósito:
--
--   insert into public.whatsapp_channel_members (channel_id, user_id, role)
--   values ('<canal>', '<usuário>', 'member');   -- ou 'supervisor'
-- ============================================================================

begin;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Quem é da casa
-- ────────────────────────────────────────────────────────────────────────────

-- `is_active` é NOT NULL DEFAULT true, então `is true` não deixa ninguém de
-- fora por engano — é exatamente "não foi desligado".
create or replace function public.is_office_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1 from public.profiles p
     where p.user_id = auth.uid()
       and p.is_active is true
  );
$$;

comment on function public.is_office_staff() is
  'É gente do escritório E está ativo. Desligar alguém em profiles.is_active tira o acesso na hora, sem esperar o JWT expirar.';

-- Administrador ativo. `is_office_admin()` já normaliza acentos no cargo;
-- aqui só se acrescenta a exigência de estar ativo.
create or replace function public.wa_is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.is_office_staff() and public.is_office_admin();
$$;

comment on function public.wa_is_admin() is
  'Administrador ATIVO — acesso global ao módulo WhatsApp, com auditoria de toda intervenção.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Supervisor COM ESCOPO
--
-- A supervisão passa a morar na própria linha de participação: ser membro do
-- canal com `role = 'supervisor'` é supervisionar aquele canal, e nada além
-- dele. Mesma ideia no setor.
--
-- `wa_is_supervisor()` continua existindo com o significado ANTIGO (= é
-- administrador). Ela é usada por policies fora do atendimento — criar canal,
-- editar etapa de funil, apagar nota de outra pessoa — e ampliá-la para
-- incluir supervisor de canal daria a um supervisor de trabalhista o poder de
-- apagar o canal do cível. Quem quer o escopo chama as funções novas.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_channel_members
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_channel_members_role_check'
  ) then
    alter table public.whatsapp_channel_members
      add constraint whatsapp_channel_members_role_check
      check (role in ('member', 'supervisor'));
  end if;
end $$;

alter table public.whatsapp_department_members
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_department_members_role_check'
  ) then
    alter table public.whatsapp_department_members
      add constraint whatsapp_department_members_role_check
      check (role in ('member', 'supervisor'));
  end if;
end $$;

comment on column public.whatsapp_channel_members.role is
  'member = atende neste canal. supervisor = acompanha TUDO deste canal, responde sem assumir e redistribui — só neste canal.';
comment on column public.whatsapp_department_members.role is
  'member = pertence ao setor. supervisor = supervisiona a fila do setor.';

create or replace function public.wa_is_supervisor()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.wa_is_admin();
$$;

comment on function public.wa_is_supervisor() is
  'Compatibilidade: significa ADMINISTRADOR ativo (é o que sempre significou). Para supervisão com escopo use wa_is_supervisor_of_channel / wa_supervises_department.';

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

-- Supervisiona ALGUM canal ou setor? Serve às telas que precisam decidir se o
-- "Modo supervisão" existe para esta pessoa, antes de haver conversa aberta.
create or replace function public.wa_is_supervisor_anywhere()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.is_office_staff() and (
    public.wa_is_admin()
    or exists (
      select 1 from public.whatsapp_channel_members cm
       where cm.user_id = auth.uid() and cm.role = 'supervisor'
    )
    or exists (
      select 1 from public.whatsapp_department_members dm
       where dm.user_id = auth.uid() and dm.role = 'supervisor'
    )
  );
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Colaborador temporário — acesso a UMA conversa, e só a ela
--
-- O caso real: pedir para um colega olhar um caso específico. Hoje isso só era
-- possível transferindo (e perdendo a conversa) ou inscrevendo a pessoa no
-- canal inteiro. A linha aqui é o meio-termo que faltava, e ela EXPIRA.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.whatsapp_conversation_collaborators (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  user_id         uuid not null,
  granted_by      uuid,
  granted_at      timestamptz not null default now(),
  -- Sem prazo explícito o acesso morre no encerramento da conversa (ver
  -- `wa_collaborator_active`). Com prazo, morre antes.
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

-- Vigente = não revogado, não expirado, e a conversa ainda aberta. Encerrar o
-- atendimento é o fim natural do empréstimo: quem foi chamado para ajudar num
-- caso não fica com a chave dele depois de o caso acabar.
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

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Transferência com ESTADO
--
-- Sem estado, "existe uma linha" era a única pergunta possível — e ela é a
-- pergunta errada. Agora a linha diz em que ponto está, e só `pending` (dentro
-- do prazo) concede alguma coisa.
--
-- Backfill: linha com `accepted_at` vira `accepted`; o resto vira `expired`,
-- porque uma transferência que ninguém aceitou e que já passou do prazo não é
-- uma pendência viva — é um rastro. Marcá-las `pending` ressuscitaria, no
-- primeiro dia, exatamente o acesso que esta migration veio cortar.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_transfers
  add column if not exists status      text        not null default 'pending',
  add column if not exists expires_at  timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_transfers_status_check'
  ) then
    alter table public.whatsapp_transfers
      add constraint whatsapp_transfers_status_check
      check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'expired'));
  end if;
end $$;

comment on column public.whatsapp_transfers.status is
  'pending | accepted | rejected | cancelled | expired. SÓ pending (e dentro de expires_at) concede acesso — histórico não autoriza nada.';
comment on column public.whatsapp_transfers.expires_at is
  'Prazo do handoff. Passou disso, a transferência vira expired e o acesso do destino acaba, mesmo que ninguém tenha clicado em nada.';

-- Prazo padrão do aceite. É o mesmo número que a fila já usa para acusar
-- "transferência travada" (DEFAULT_QUEUE_POLICY.transferAcceptTimeoutMinutes),
-- multiplicado por uma folga: a fila ACUSA aos 15 minutos, o acesso só CAI
-- depois de 24 horas. Acusar cedo e revogar tarde é de propósito — o barulho
-- deve chegar muito antes da porta fechar.
create or replace function public.wa_transfer_default_ttl()
returns interval
language sql
immutable
as $$ select interval '24 hours' $$;

update public.whatsapp_transfers
   set status      = 'accepted',
       resolved_at = coalesce(resolved_at, accepted_at),
       resolved_by = coalesce(resolved_by, accepted_by)
 where accepted_at is not null
   and status = 'pending';

update public.whatsapp_transfers
   set status      = 'expired',
       resolved_at = coalesce(resolved_at, created_at + public.wa_transfer_default_ttl())
 where accepted_at is null
   and status = 'pending'
   and created_at + public.wa_transfer_default_ttl() <= now();

update public.whatsapp_transfers
   set expires_at = created_at + public.wa_transfer_default_ttl()
 where expires_at is null;

create index if not exists whatsapp_transfers_pendentes_idx
  on public.whatsapp_transfers (conversation_id, status, created_at desc)
  where status = 'pending';

create index if not exists whatsapp_transfers_destino_pendente_idx
  on public.whatsapp_transfers (to_user_id, status)
  where status = 'pending';

-- Uma transferência pendente destinada a MIM (ou ao meu setor), ainda no prazo.
-- É a única forma de o histórico de transferências conceder qualquer coisa.
create or replace function public.wa_pending_transfer_for_me(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
      from public.whatsapp_transfers t
     where t.conversation_id = p_conv
       and t.status = 'pending'
       and (t.expires_at is null or t.expires_at > now())
       and (
         t.to_user_id = auth.uid()
         or (
           t.to_user_id is null
           and t.to_department_id is not null
           and exists (
             select 1 from public.whatsapp_department_members dm
              where dm.department_id = t.to_department_id
                and dm.user_id = auth.uid()
           )
         )
       )
  );
$$;

-- Durante o `pending`, a ORIGEM também precisa continuar enxergando: ela ainda
-- responde pelo atendimento até alguém aceitar, e é dela a decisão de cancelar.
-- Diferente do que havia antes, isto acaba quando o pending acaba.
create or replace function public.wa_pending_transfer_from_me(p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1
      from public.whatsapp_transfers t
     where t.conversation_id = p_conv
       and t.status = 'pending'
       and (t.expires_at is null or t.expires_at > now())
       and (t.from_user_id = auth.uid() or t.performed_by = auth.uid())
  );
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. (sem backfill — ver a nota no cabeçalho)
--
-- O relatório de quem PERDE acesso com esta migration, para conferir antes de
-- aplicar. Ele não muda nada; só imprime. Espera-se uma lista vazia.
-- ────────────────────────────────────────────────────────────────────────────

do $$
declare
  r record;
  v_total integer := 0;
begin
  for r in
    select p.name, i.name as canal, count(*) as conversas
      from public.profiles p
      join public.whatsapp_conversations c
        on c.assigned_user_id is distinct from p.user_id
      join public.whatsapp_instances i on i.id = c.instance_id
     where p.is_active is true
       and i.visibility_mode <> 'all'
       -- Via que esta migration REMOVE: histórico de transferência.
       and exists (
         select 1 from public.whatsapp_transfers t
          where t.conversation_id = c.id
            and (t.to_user_id = p.user_id or t.from_user_id = p.user_id)
       )
       -- E que nenhuma via preservada repõe.
       and not exists (
         select 1 from public.whatsapp_channel_members cm
          where cm.channel_id = c.instance_id and cm.user_id = p.user_id
       )
       and lower(translate(coalesce(p.role, ''),
             'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ',
             'aaaaeeiooouucAAAAEEIOOOUUC')) <> 'administrador'
     group by p.name, i.name
  loop
    v_total := v_total + 1;
    raise notice 'PERDE ACESSO: % deixa de ver % conversa(s) do canal %',
      r.name, r.conversas, r.canal;
  end loop;

  if v_total = 0 then
    raise notice 'Ninguém perde acesso: o histórico de transferência não era a única via de ninguém.';
  else
    raise notice 'ATENÇÃO: % pessoa(s)/canal acima. Se o acesso for legítimo, inscreva em whatsapp_channel_members ANTES de aplicar.', v_total;
  end if;
end $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. As funções de visibilidade, sem o atalho do histórico
-- ────────────────────────────────────────────────────────────────────────────

-- Ler a LINHA do canal (nome, cor, telefone) não é o mesmo que ler as
-- conversas dele — quem tem uma conversa atribuída num canal precisa do rótulo
-- para a tela dela fazer sentido, e isso não abre a inbox de ninguém: as
-- conversas continuam recortadas por `wa_can_see_conv`.
create or replace function public.wa_can_see_channel(p_channel uuid, p_visibility_mode text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.is_office_staff() and (
    public.wa_is_admin()
    or p_visibility_mode = 'all'
    or exists (
      select 1 from public.whatsapp_channel_members cm
       where cm.channel_id = p_channel and cm.user_id = auth.uid()
    )
    -- Responsável por conversa viva neste canal. Conversa ENCERRADA não conta:
    -- ter atendido um caso ano passado não é motivo para o canal continuar
    -- listado hoje.
    or exists (
      select 1 from public.whatsapp_conversations c
       where c.instance_id = p_channel
         and c.assigned_user_id = auth.uid()
         and c.status <> 'closed'
    )
    -- Handoff em curso ou empréstimo vigente: precisa do rótulo enquanto durar.
    or exists (
      select 1 from public.whatsapp_conversations c
       where c.instance_id = p_channel
         and (
           public.wa_pending_transfer_for_me(c.id)
           or public.wa_collaborator_active(c.id, auth.uid())
         )
    )
  );
$$;

comment on function public.wa_can_see_channel(uuid, text) is
  'Pode LER a linha do canal. Não confundir com ver as conversas dele (wa_can_see_conv). Transferência ANTIGA não concede mais nada aqui.';

create or replace function public.wa_can_see_conv(p_channel uuid, p_dept uuid, p_assigned uuid, p_conv uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.is_office_staff() and (
    -- Administrador: acesso global, e toda intervenção dele é auditada nas RPCs.
    public.wa_is_admin()
    -- Responsável atual.
    or p_assigned = auth.uid()
    -- Supervisor DO canal / DO setor desta conversa — e de nenhum outro.
    or public.wa_is_supervisor_of_channel(p_channel)
    or public.wa_supervises_department(p_dept)
    -- Handoff vigente, nos dois sentidos, enquanto durar o `pending`.
    or public.wa_pending_transfer_for_me(p_conv)
    or public.wa_pending_transfer_from_me(p_conv)
    -- Empréstimo explícito desta conversa (não do canal).
    or public.wa_collaborator_active(p_conv, auth.uid())
    -- Fila: membro do canal (ou canal aberto), respeitando o setor.
    or (
      (
        p_channel is null
        or exists (
          select 1 from public.whatsapp_instances i
           where i.id = p_channel and i.visibility_mode = 'all'
        )
        or exists (
          select 1 from public.whatsapp_channel_members cm
           where cm.channel_id = p_channel and cm.user_id = auth.uid()
        )
      )
      and (
        p_dept is null
        or not exists (
          select 1 from public.whatsapp_department_members dm
           where dm.department_id = p_dept
        )
        or exists (
          select 1 from public.whatsapp_department_members dm
           where dm.department_id = p_dept and dm.user_id = auth.uid()
        )
      )
    )
  );
$$;

comment on function public.wa_can_see_conv(uuid, uuid, uuid, uuid) is
  'Pode VER esta conversa. Ver não é poder agir: para agir, wa_can_manage_conv / wa_can_reply_conv.';

-- ────────────────────────────────────────────────────────────────────────────
-- 7. As funções de AÇÃO — ver deixa de ser sinônimo de poder
--
-- É aqui que "apenas acompanhar" ganha sentido no banco, e não só na tela: o
-- supervisor ENXERGA por `wa_can_see_conv`, mas alterar responsável, fila, SLA
-- ou leitura exige `wa_can_manage_conv`, e responder exige `wa_can_reply_conv`.
-- ────────────────────────────────────────────────────────────────────────────

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
         -- Conversa SEM dono é da fila: quem pode vê-la pode assumi-la. É o que
         -- mantém "assumir" a um clique para o atendente comum.
         or (c.assigned_user_id is null
             and public.wa_can_see_conv(c.instance_id, c.department_id, c.assigned_user_id, c.id))
       )
  );
$$;

-- Mandar mensagem para o cliente por esta conversa.
--
-- O colaborador temporário responde: foi para isso que ele foi chamado. O que
-- ele NÃO pode é mexer no atendimento — quem responde por ele continua sendo
-- outra pessoa, e é por isso que as duas funções são separadas.
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

-- Transferir. O atendente comum transfere o que é DELE (ou o que está na fila
-- e ele poderia assumir). Terceiro só o supervisor daquele canal/setor move.
create or replace function public.wa_can_transfer_conv(p_conv uuid)
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
         or public.wa_is_supervisor_of_channel(c.instance_id)
         or public.wa_supervises_department(c.department_id)
         or c.assigned_user_id = auth.uid()
         or (c.assigned_user_id is null and public.wa_can_manage_conv(c.id))
       )
  );
$$;

-- Aceitar uma transferência. Diferente de tudo acima: aqui a autorização é a
-- PRÓPRIA transferência, não a conversa. Quem aceita ainda não tem acesso por
-- outro caminho — é o aceite que o cria.
create or replace function public.wa_can_accept_transfer(p_transfer_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select exists (
    select 1 from public.whatsapp_transfers t
     where t.id = p_transfer_id
       and t.status = 'pending'
       and (t.expires_at is null or t.expires_at > now())
       and public.is_office_staff()
       and (
         t.to_user_id = auth.uid()
         or (
           t.to_user_id is null
           and t.to_department_id is not null
           and exists (
             select 1 from public.whatsapp_department_members dm
              where dm.department_id = t.to_department_id and dm.user_id = auth.uid()
           )
         )
         -- Administrador aceita no lugar de quem sumiu (fica auditado).
         or public.wa_is_admin()
       )
  );
$$;

-- O DESTINO aguenta receber? Ativo, e com acesso ao canal e ao setor da
-- conversa. Sem isto, transferir é jogar a conversa num buraco: o destino não
-- consegue nem abrir, e o cliente fica esperando alguém que nunca vai ver.
create or replace function public.wa_destination_can_access(
  p_conv uuid,
  p_to_user uuid,
  p_to_department uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
declare
  v_conv   public.whatsapp_conversations%rowtype;
  v_dept   uuid;
begin
  select * into v_conv from public.whatsapp_conversations where id = p_conv;
  if not found then return false; end if;

  -- Destino de SETOR: o setor precisa existir, estar ativo e ter alguém dentro.
  if p_to_user is null then
    if p_to_department is null then return false; end if;
    return exists (
      select 1 from public.whatsapp_departments d
       where d.id = p_to_department and coalesce(d.is_active, true)
    ) and exists (
      select 1 from public.whatsapp_department_members dm
       where dm.department_id = p_to_department
    );
  end if;

  -- Destino PESSOA: tem de estar ativo…
  if not exists (
    select 1 from public.profiles p where p.user_id = p_to_user and p.is_active is true
  ) then
    return false;
  end if;

  -- …e enxergar o canal da conversa (admin enxerga tudo; canal 'all' é aberto).
  if not (
    exists (select 1 from public.profiles p
             where p.user_id = p_to_user
               and lower(translate(coalesce(p.role, ''),
                     'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇ',
                     'aaaaeeiooouucAAAAEEIOOOUUC')) = 'administrador')
    or v_conv.instance_id is null
    or exists (select 1 from public.whatsapp_instances i
                where i.id = v_conv.instance_id and i.visibility_mode = 'all')
    or exists (select 1 from public.whatsapp_channel_members cm
                where cm.channel_id = v_conv.instance_id and cm.user_id = p_to_user)
  ) then
    return false;
  end if;

  -- …e pertencer ao setor de destino, quando houver um.
  v_dept := coalesce(p_to_department, v_conv.department_id);
  if v_dept is not null
     and exists (select 1 from public.whatsapp_department_members dm where dm.department_id = v_dept)
     and not exists (
       select 1 from public.whatsapp_department_members dm
        where dm.department_id = v_dept and dm.user_id = p_to_user
     ) then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.wa_destination_can_access(uuid, uuid, uuid) is
  'O destino consegue mesmo abrir esta conversa depois de recebê-la? Impede a transferência que some com o atendimento.';

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Ligações — fechando o ramo do "não achei conversa"
--
-- `whatsapp_call_logs` ganha `instance_id`: sem ele, a ligação para um número
-- que ainda não virou conversa não tem a que herdar permissão, e era esse vazio
-- que o ramo aberto preenchia. Com o canal na linha, a ligação herda a regra do
-- canal — que é a resposta certa quando ainda não existe conversa.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.whatsapp_call_logs
  add column if not exists instance_id uuid references public.whatsapp_instances(id) on delete set null;

comment on column public.whatsapp_call_logs.instance_id is
  'Canal pelo qual a ligação passou. É por ele que a ligação SEM conversa herda permissão, em vez de ficar visível para todos.';

update public.whatsapp_call_logs l
   set instance_id = c.instance_id
  from public.whatsapp_conversations c
 where l.conversation_id = c.id
   and l.instance_id is null
   and c.instance_id is not null;

create index if not exists whatsapp_call_logs_instance_idx
  on public.whatsapp_call_logs (instance_id);

create or replace function public.wa_can_see_call(p_conv uuid, p_phone text, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.is_office_staff() and (
    public.wa_is_admin()
    -- Quem falou ao telefone vê a própria ligação, sempre.
    or (p_user is not null and p_user = auth.uid())
    -- Com conversa, a regra é a da conversa. Sem exceção e sem plano B: se a
    -- conversa não é visível, a ligação dela também não é.
    or case
         when p_conv is not null then public.wa_can_see_conv_id(p_conv)
         else exists (
           select 1
             from public.whatsapp_conversations k
            where length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 8
              and right(regexp_replace(coalesce(k.contact_phone, ''), '\D', '', 'g'), 8)
                = right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 8)
              and public.wa_can_see_conv(k.instance_id, k.department_id, k.assigned_user_id, k.id)
         )
       end
  );
$$;

comment on function public.wa_can_see_call(uuid, text, uuid) is
  'A ligação herda a permissão da conversa. Antes, telefone sem conversa nenhuma era visível para o escritório inteiro — o ramo aberto saiu; o buraco que ele tapava agora é tapado por wa_can_see_call_row, que olha o canal.';

-- A policy passa a usar esta, que enxerga a linha inteira (inclusive o canal).
-- Mantemos `wa_can_see_call` com a assinatura de sempre porque o `wa_media_visivel`
-- (policy do Storage) a chama com as três colunas da gravação.
create or replace function public.wa_can_see_call_row(
  p_conv uuid, p_phone text, p_user uuid, p_instance uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select public.wa_can_see_call(p_conv, p_phone, p_user)
      or (
        -- Sem conversa para herdar: herda do CANAL. É o caso da ligação para um
        -- número novo, que ainda não escreveu nada.
        p_conv is null
        and p_instance is not null
        and public.is_office_staff()
        and exists (
          select 1 from public.whatsapp_instances i
           where i.id = p_instance
             and public.wa_can_see_channel(i.id, i.visibility_mode)
        )
      );
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Policies — a escrita passa a exigir acesso à CONVERSA
--
-- Até aqui, ler era recortado por canal e escrever não era recortado por nada.
-- ────────────────────────────────────────────────────────────────────────────

-- ── whatsapp_transfers: ninguém escreve à mão. ─────────────────────────────
-- Era o autosserviço de crachá descrito no cabeçalho. As RPCs são SECURITY
-- DEFINER e continuam escrevendo normalmente; o que fecha é o caminho direto
-- pelo PostgREST.
drop policy if exists wa_transfers_insert on public.whatsapp_transfers;
drop policy if exists wa_transfers_update on public.whatsapp_transfers;
drop policy if exists wa_transfers_delete on public.whatsapp_transfers;

create policy wa_transfers_sem_escrita_direta on public.whatsapp_transfers
  for insert to authenticated with check (false);
create policy wa_transfers_sem_update_direto on public.whatsapp_transfers
  for update to authenticated using (false) with check (false);
create policy wa_transfers_sem_delete_direto on public.whatsapp_transfers
  for delete to authenticated using (false);

-- A leitura também para de vazar: aparecer numa transferência antiga de uma
-- conversa que não posso ver não é motivo para ler a linha dela.
drop policy if exists wa_transfers_select on public.whatsapp_transfers;
create policy wa_transfers_select on public.whatsapp_transfers
  for select to authenticated
  using (
    public.is_office_staff() and (
      public.wa_can_see_conv_id(conversation_id)
      -- Destino de transferência pendente: precisa ler a linha para poder
      -- aceitar, e é justamente antes de ter acesso à conversa.
      or (status = 'pending' and to_user_id = auth.uid())
    )
  );

-- ── whatsapp_messages: escrever exige poder responder. ─────────────────────
drop policy if exists wa_msg_insert on public.whatsapp_messages;
create policy wa_msg_insert on public.whatsapp_messages
  for insert to authenticated
  with check (public.wa_can_reply_conv(conversation_id));

drop policy if exists wa_msg_update on public.whatsapp_messages;
create policy wa_msg_update on public.whatsapp_messages
  for update to authenticated
  using (public.wa_can_see_conv_id(conversation_id))
  with check (public.wa_can_reply_conv(conversation_id));

-- Apagar mensagem do histórico é destrutivo e vale para a equipe inteira.
drop policy if exists wa_msg_delete on public.whatsapp_messages;
create policy wa_msg_delete on public.whatsapp_messages
  for delete to authenticated
  using (
    public.wa_can_see_conv_id(conversation_id)
    and (
      public.wa_is_admin()
      or public.wa_can_manage_conv(conversation_id)
    )
  );

-- ── whatsapp_conversations: o UPDATE não pode reescrever a própria chave. ──
-- O `with check (is_office_staff())` de antes deixava mudar `instance_id` de
-- uma conversa visível para qualquer canal — inclusive para dentro de um canal
-- restrito, arrastando a conversa (e o direito de vê-la) junto.
drop policy if exists wa_conv_update on public.whatsapp_conversations;
create policy wa_conv_update on public.whatsapp_conversations
  for update to authenticated
  using (public.wa_can_see_conv(instance_id, department_id, assigned_user_id, id))
  with check (public.wa_can_see_conv(instance_id, department_id, assigned_user_id, id));

drop policy if exists wa_conv_delete on public.whatsapp_conversations;
create policy wa_conv_delete on public.whatsapp_conversations
  for delete to authenticated
  using (public.wa_is_admin());

-- ── Notas, bloqueios, agendamentos: escrever onde se pode responder. ───────
drop policy if exists wa_note_insert on public.whatsapp_internal_notes;
create policy wa_note_insert on public.whatsapp_internal_notes
  for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and public.wa_can_see_conv_id(conversation_id)
  );

drop policy if exists wa_blocks_insert on public.whatsapp_contact_blocks;
create policy wa_blocks_insert on public.whatsapp_contact_blocks
  for insert to authenticated
  with check (public.wa_can_manage_conv(conversation_id));

drop policy if exists wa_sched_insert on public.whatsapp_scheduled_messages;
create policy wa_sched_insert on public.whatsapp_scheduled_messages
  for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.wa_can_reply_conv(conversation_id)
  );

-- ── Ligações: a policy passa a olhar o canal também. ──────────────────────
drop policy if exists wa_call_logs_select on public.whatsapp_call_logs;
create policy wa_call_logs_select on public.whatsapp_call_logs
  for select to authenticated
  using (public.wa_can_see_call_row(conversation_id, phone, user_id, instance_id));

drop policy if exists wa_call_logs_update on public.whatsapp_call_logs;
create policy wa_call_logs_update on public.whatsapp_call_logs
  for update to authenticated
  using (public.wa_can_see_call_row(conversation_id, phone, user_id, instance_id))
  with check (public.wa_can_see_call_row(conversation_id, phone, user_id, instance_id));

drop policy if exists wa_call_logs_delete on public.whatsapp_call_logs;
create policy wa_call_logs_delete on public.whatsapp_call_logs
  for delete to authenticated
  using (public.wa_is_admin());

drop policy if exists wa_call_logs_insert on public.whatsapp_call_logs;
create policy wa_call_logs_insert on public.whatsapp_call_logs
  for insert to authenticated
  with check (
    public.is_office_staff()
    and (conversation_id is null or public.wa_can_see_conv_id(conversation_id))
  );

-- ── IA: ler o que a IA escreveu já segue a conversa; ESCREVER não seguia. ──
drop policy if exists wa_ai_meetings_insert on public.whatsapp_ai_meeting_requests;
create policy wa_ai_meetings_insert on public.whatsapp_ai_meeting_requests
  for insert to authenticated
  with check (public.wa_can_see_conv_id(conversation_id));

drop policy if exists ai_sessions_insert on public.whatsapp_ai_sessions;
create policy ai_sessions_insert on public.whatsapp_ai_sessions
  for insert to authenticated
  with check (public.wa_can_see_conv_id(conversation_id));

-- Configuração da IA (prompt, playbook, agente, assistente) é ajuste de
-- comportamento do escritório inteiro — não é operação de atendimento.
drop policy if exists wa_ai_agents_staff on public.whatsapp_ai_agents;
create policy wa_ai_agents_leitura on public.whatsapp_ai_agents
  for select to authenticated using (public.is_office_staff());
create policy wa_ai_agents_escrita on public.whatsapp_ai_agents
  for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin());

drop policy if exists wa_ai_agent_versions_staff on public.whatsapp_ai_agent_versions;
create policy wa_ai_agent_versions_leitura on public.whatsapp_ai_agent_versions
  for select to authenticated using (public.is_office_staff());
create policy wa_ai_agent_versions_escrita on public.whatsapp_ai_agent_versions
  for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin());

drop policy if exists ai_config_staff on public.whatsapp_ai_channel_config;
create policy ai_config_leitura on public.whatsapp_ai_channel_config
  for select to authenticated using (public.is_office_staff());
create policy ai_config_escrita on public.whatsapp_ai_channel_config
  for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin());

drop policy if exists ai_playbooks_staff on public.whatsapp_ai_playbooks;
create policy ai_playbooks_leitura on public.whatsapp_ai_playbooks
  for select to authenticated using (public.is_office_staff());
create policy ai_playbooks_escrita on public.whatsapp_ai_playbooks
  for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin());

drop policy if exists wa_ai_assistants_staff on public.whatsapp_ai_assistants;
create policy wa_ai_assistants_leitura on public.whatsapp_ai_assistants
  for select to authenticated using (public.is_office_staff());
create policy wa_ai_assistants_escrita on public.whatsapp_ai_assistants
  for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin());

-- ── Quem entra em canal e em setor: nunca a própria pessoa. ───────────────
-- `whatsapp_department_members` aceitava `ALL` para qualquer funcionário: dava
-- para se inscrever no setor e, com isso, passar pelo filtro de setor e aceitar
-- transferências dirigidas a ele.
drop policy if exists wa_dept_member_staff on public.whatsapp_department_members;
create policy wa_dept_member_select on public.whatsapp_department_members
  for select to authenticated using (public.is_office_staff());
create policy wa_dept_member_escrita on public.whatsapp_department_members
  for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin());

drop policy if exists wa_dept_staff on public.whatsapp_departments;
create policy wa_dept_select on public.whatsapp_departments
  for select to authenticated using (public.is_office_staff());
create policy wa_dept_escrita on public.whatsapp_departments
  for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin());

drop policy if exists wa_channel_dept_staff on public.whatsapp_channel_departments;
create policy wa_channel_dept_select on public.whatsapp_channel_departments
  for select to authenticated using (public.is_office_staff());
create policy wa_channel_dept_escrita on public.whatsapp_channel_departments
  for all to authenticated using (public.wa_is_admin()) with check (public.wa_is_admin());

-- Membro de canal: só o administrador concede. A leitura fica restrita ao que
-- interessa — o próprio vínculo e os canais que a pessoa já enxerga.
drop policy if exists wa_channel_member_select on public.whatsapp_channel_members;
create policy wa_channel_member_select on public.whatsapp_channel_members
  for select to authenticated
  using (
    public.is_office_staff() and (
      user_id = (select auth.uid())
      or public.wa_is_admin()
      or public.wa_is_supervisor_of_channel(channel_id)
    )
  );

-- ── Colaborador temporário: quem empresta é quem manda na conversa. ───────
create policy wa_collab_select on public.whatsapp_conversation_collaborators
  for select to authenticated
  using (
    public.is_office_staff()
    and (user_id = (select auth.uid()) or public.wa_can_manage_conv(conversation_id))
  );

create policy wa_collab_insert on public.whatsapp_conversation_collaborators
  for insert to authenticated
  with check (
    granted_by = (select auth.uid())
    and public.wa_can_manage_conv(conversation_id)
    and exists (select 1 from public.profiles p where p.user_id = user_id and p.is_active is true)
  );

create policy wa_collab_update on public.whatsapp_conversation_collaborators
  for update to authenticated
  using (public.wa_can_manage_conv(conversation_id))
  with check (public.wa_can_manage_conv(conversation_id));

create policy wa_collab_delete on public.whatsapp_conversation_collaborators
  for delete to authenticated
  using (public.wa_can_manage_conv(conversation_id));

-- ── Nova transferência encerra os empréstimos da conversa. ───────────────
-- Regra do modelo: "acesso termina no encerramento, nova transferência,
-- remoção ou expiração". As três últimas já estão cobertas; esta é a segunda.
create or replace function public.wa_revoke_collaborators_on_transfer()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $$
begin
  update public.whatsapp_conversation_collaborators
     set revoked_at = now(),
         revoked_by = new.performed_by
   where conversation_id = new.conversation_id
     and revoked_at is null;
  return new;
end;
$$;

drop trigger if exists wa_transfer_revoga_colaboradores on public.whatsapp_transfers;
create trigger wa_transfer_revoga_colaboradores
  after insert on public.whatsapp_transfers
  for each row execute function public.wa_revoke_collaborators_on_transfer();

-- ────────────────────────────────────────────────────────────────────────────
-- 10. GRANTs — nada de PUBLIC nem de anon nas funções internas
-- ────────────────────────────────────────────────────────────────────────────

revoke all on function public.is_office_staff()            from public, anon;
revoke all on function public.wa_can_see_conv(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.wa_can_see_channel(uuid, text) from public, anon;

grant execute on function public.is_office_staff()                        to authenticated, service_role;
grant execute on function public.wa_is_admin()                            to authenticated, service_role;
grant execute on function public.wa_is_supervisor()                       to authenticated, service_role;
grant execute on function public.wa_is_supervisor_of_channel(uuid)        to authenticated, service_role;
grant execute on function public.wa_supervises_department(uuid)           to authenticated, service_role;
grant execute on function public.wa_is_supervisor_anywhere()              to authenticated, service_role;
grant execute on function public.wa_collaborator_active(uuid, uuid)       to authenticated, service_role;
grant execute on function public.wa_pending_transfer_for_me(uuid)         to authenticated, service_role;
grant execute on function public.wa_pending_transfer_from_me(uuid)        to authenticated, service_role;
grant execute on function public.wa_can_see_channel(uuid, text)           to authenticated, service_role;
grant execute on function public.wa_can_see_conv(uuid, uuid, uuid, uuid)  to authenticated, service_role;
grant execute on function public.wa_can_manage_conv(uuid)                 to authenticated, service_role;
grant execute on function public.wa_can_reply_conv(uuid)                  to authenticated, service_role;
grant execute on function public.wa_can_transfer_conv(uuid)               to authenticated, service_role;
grant execute on function public.wa_can_accept_transfer(uuid)             to authenticated, service_role;
grant execute on function public.wa_destination_can_access(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.wa_can_see_call_row(uuid, text, uuid, uuid) to authenticated, service_role;
grant execute on function public.wa_transfer_default_ttl()                to authenticated, service_role;

grant select, insert, update, delete on public.whatsapp_conversation_collaborators to authenticated;
grant all on public.whatsapp_conversation_collaborators to service_role;

commit;
