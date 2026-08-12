-- ============================================================================
-- Assistente de IA do WhatsApp (MVP) — agentes configuráveis por texto.
--
-- O que entra:
--   whatsapp_ai_assistants  — o agente (2 áreas de instrução, ações, follow-up)
--   whatsapp_ai_executions  — log de cada execução (diagnóstico + idempotência)
--   whatsapp_ai_followups   — acompanhamentos agendados pelo agente
--   + colunas novas em whatsapp_ai_channel_config (vínculo canal→agente)
--   + colunas novas em whatsapp_ai_sessions       (memória por conversa)
--
-- POR QUE `whatsapp_ai_assistants` E NÃO `whatsapp_ai_agents`: a tabela
-- `whatsapp_ai_agents` da tentativa anterior AINDA EXISTE no banco de produção
-- (com 4 linhas). A migration que a derruba — 20260808180000 — está no
-- repositório mas nunca foi aplicada. Reaproveitar o nome faria esta migration
-- depender da ordem de aplicação daquela, e quebraria em qualquer ambiente onde
-- o drop ainda não rodou. Nome novo = zero colisão, em qualquer ordem.
--
-- REUSO, NÃO SUBSTITUIÇÃO: `whatsapp_ai_channel_config` e `whatsapp_ai_sessions`
-- são de junho e continuam sendo as tabelas de config-por-canal e de estado-por-
-- conversa. Aqui elas só GANHAM colunas. As colunas antigas (playbook_id,
-- current_step, collected_data, pending_ai_reply) ficam de pé e sem uso.
--
-- Nada de conversas, mensagens, instâncias, funil, documentos ou assinatura é
-- tocado.
-- ============================================================================

begin;

-- ── 1. O agente ─────────────────────────────────────────────────────────────
create table if not exists public.whatsapp_ai_assistants (
  id                     uuid primary key default gen_random_uuid(),

  -- Identificação
  name                   text not null check (length(btrim(name)) between 1 and 120),
  description            text,
  provider               text not null default 'openai',
  model                  text not null default 'gpt-4o-mini',
  is_active              boolean not null default true,

  -- 'test' = gera resposta e registra as ações sugeridas, sem enviar nem executar.
  -- 'auto' = envia a resposta e executa as ações permitidas.
  mode                   text not null default 'test' check (mode in ('test', 'auto')),

  -- As duas áreas de instrução. Texto corrido escrito pelo administrador; podem
  -- conter expressões `ação=nome(Destino)` cujas referências compiladas ficam em
  -- `action_refs`. O texto é o que vai para o modelo; os IDs, não.
  instructions_do        text not null default '',
  instructions_dont      text not null default '',

  -- Allowlist: só estas ações são oferecidas ao modelo e só estas podem rodar.
  allowed_actions        text[] not null default '{}',

  -- Referências compiladas do editor de prompt:
  -- [{action, target_type, target_id, target_label, raw}]
  -- O backend restringe o destino de cada ação ao que está aqui.
  action_refs            jsonb  not null default '[]'::jsonb,

  -- Follow-up
  followup_enabled       boolean not null default false,
  followup_instructions  text not null default '',
  followup_max_attempts  int  not null default 3 check (followup_max_attempts between 1 and 10),
  followup_strategy      text not null default 'fixed'
                         check (followup_strategy in ('fixed', 'progressive', 'custom')),
  -- 'fixed': sempre este intervalo. 'progressive': dobra a cada tentativa.
  followup_interval_hours numeric(6,2) not null default 24
                         check (followup_interval_hours between 0.25 and 720),
  -- 'custom': os intervalos explícitos, em horas, na ordem (ex.: {4,24,72}).
  -- Permite representar intervalos decrescentes sem fórmula.
  followup_custom_hours  numeric(6,2)[] not null default '{}',
  -- Janela permitida. Dias: 0=domingo … 6=sábado. Minutos desde a meia-noite.
  followup_days          int[] not null default '{1,2,3,4,5}',
  followup_start_minute  int not null default 480  check (followup_start_minute between 0 and 1439),
  followup_end_minute    int not null default 1080 check (followup_end_minute   between 1 and 1440),
  timezone               text not null default 'America/Cuiaba',

  -- Execução
  debounce_seconds       int not null default 8  check (debounce_seconds between 0 and 60),
  history_limit          int not null default 12 check (history_limit between 2 and 40),

  created_by             uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  constraint wa_ai_assistants_followup_window check (followup_end_minute > followup_start_minute)
);

comment on table public.whatsapp_ai_assistants is
  'Agente de IA do WhatsApp: instruções em texto livre + allowlist de ações. Reutilizável por vários canais; a memória é por conversa.';
comment on column public.whatsapp_ai_assistants.action_refs is
  'Referências compiladas das expressões ação=...(...) do prompt. O backend só executa destinos presentes aqui.';

-- ── 2. Vínculo canal → agente ───────────────────────────────────────────────
-- Um agente serve N canais; cada canal aponta para no máximo um agente.
alter table public.whatsapp_ai_channel_config
  add column if not exists assistant_id uuid
    references public.whatsapp_ai_assistants(id) on delete set null;

create index if not exists idx_wa_ai_channel_config_assistant
  on public.whatsapp_ai_channel_config (assistant_id)
  where assistant_id is not null;

-- ── 3. Memória por conversa (extensão de whatsapp_ai_sessions) ──────────────
-- O banco do CRM é a fonte da memória: nada depende de um id de thread mantido
-- pelo provedor de IA. Troca de modelo, queda do provedor ou reinício não
-- perdem o fio da conversa.
alter table public.whatsapp_ai_sessions
  add column if not exists assistant_id              uuid references public.whatsapp_ai_assistants(id) on delete set null,
  -- Interruptor por conversa. Vai a false no handoff humano e NÃO volta sozinho.
  add column if not exists ai_active                 boolean not null default true,
  add column if not exists summary                   text,
  add column if not exists known_facts               jsonb not null default '{}'::jsonb,
  add column if not exists pending_items             jsonb not null default '[]'::jsonb,
  add column if not exists last_action               text,
  add column if not exists last_processed_message_id uuid,
  add column if not exists last_customer_message_at  timestamptz,
  add column if not exists next_followup_at          timestamptz,
  add column if not exists followup_attempts         int not null default 0,
  add column if not exists handoff_reason            text,
  -- Trava de execução: impede dois turnos simultâneos na mesma conversa.
  add column if not exists lock_token                uuid,
  add column if not exists locked_until              timestamptz,
  add column if not exists updated_at                timestamptz not null default now();

create index if not exists idx_wa_ai_sessions_assistant
  on public.whatsapp_ai_sessions (assistant_id)
  where assistant_id is not null;

-- ── 3b. Tirar whatsapp_ai_sessions da publicação de realtime ────────────────
-- A tabela entrou na publicação em junho para um banner que a remoção do
-- atendente anterior levou junto: hoje NENHUM ponto do front assina esta tabela
-- — ela só aparece em consultas diretas. Até agora isso não custava nada porque
-- a tabela estava vazia; a partir desta migration ela passa a receber uma
-- escrita por turno de conversa.
--
-- Publicar escrita que ninguém escuta é exatamente o que fez o Realtime deste
-- projeto consumir 289 GB em 4 horas para 350 escritas. As tabelas novas
-- (assistants, executions, followups) nascem fora da publicação pelo mesmo
-- motivo; o painel da conversa lê sob demanda, ao ser aberto.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whatsapp_ai_sessions'
  ) then
    execute 'alter publication supabase_realtime drop table public.whatsapp_ai_sessions';
  end if;
end$$;

-- ── 4. Log de execuções ─────────────────────────────────────────────────────
-- Serve a dois propósitos: diagnóstico (o que o modelo respondeu, o que pediu,
-- o que rodou) e IDEMPOTÊNCIA — a chave única barra a reentrega do webhook.
create table if not exists public.whatsapp_ai_executions (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references public.whatsapp_conversations(id) on delete cascade,
  assistant_id       uuid references public.whatsapp_ai_assistants(id) on delete set null,
  channel_id         uuid references public.whatsapp_instances(id) on delete set null,
  provider           text,
  model              text,
  mode               text not null default 'auto',
  trigger_message_id uuid references public.whatsapp_messages(id) on delete set null,
  -- '<conversation_id>:<trigger_message_id>' ou ':followup:<followup_id>'
  idempotency_key    text not null unique,
  reply_text         text,
  requested_actions  jsonb not null default '[]'::jsonb,
  executed_actions   jsonb not null default '[]'::jsonb,
  error              text,
  duration_ms        int,
  status             text not null default 'ok'
                     check (status in ('ok', 'skipped', 'error', 'test')),
  created_at         timestamptz not null default now()
);

create index if not exists idx_wa_ai_executions_conv
  on public.whatsapp_ai_executions (conversation_id, created_at desc);

-- ── 5. Follow-ups do agente ─────────────────────────────────────────────────
-- Quem dispara é o cron que JÁ EXISTE (whatsapp-scheduler, de minuto em minuto).
-- Não há cron novo. O envio sai pelo mesmo caminho resiliente das demais
-- mensagens automáticas (evolution-send).
--
-- Os follow-ups ESPECIALIZADOS de documentos, preenchimento e assinatura
-- continuam com seus próprios mecanismos — esta tabela não os duplica.
create table if not exists public.whatsapp_ai_followups (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  assistant_id    uuid references public.whatsapp_ai_assistants(id) on delete set null,
  attempt         int not null default 1 check (attempt >= 1),
  scheduled_at    timestamptz not null,
  message         text not null check (length(btrim(message)) between 1 and 1200),
  reason          text,
  status          text not null default 'pending'
                  check (status in ('pending', 'sent', 'cancelled', 'failed')),
  cancel_reason   text,
  sent_at         timestamptz,
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Um único follow-up pendente por conversa: é o que impede a IA de empilhar
-- lembretes e mandar duas mensagens no mesmo intervalo.
create unique index if not exists uniq_wa_ai_followup_pending
  on public.whatsapp_ai_followups (conversation_id)
  where status = 'pending';

create index if not exists idx_wa_ai_followups_due
  on public.whatsapp_ai_followups (scheduled_at)
  where status = 'pending';

-- ── 6. updated_at ───────────────────────────────────────────────────────────
create or replace function public.wa_ai_assistant_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_wa_ai_assistants_touch on public.whatsapp_ai_assistants;
create trigger trg_wa_ai_assistants_touch
  before update on public.whatsapp_ai_assistants
  for each row execute function public.wa_ai_assistant_touch();

drop trigger if exists trg_wa_ai_followups_touch on public.whatsapp_ai_followups;
create trigger trg_wa_ai_followups_touch
  before update on public.whatsapp_ai_followups
  for each row execute function public.wa_ai_assistant_touch();

drop trigger if exists trg_wa_ai_sessions_touch on public.whatsapp_ai_sessions;
create trigger trg_wa_ai_sessions_touch
  before update on public.whatsapp_ai_sessions
  for each row execute function public.wa_ai_assistant_touch();

-- ── 7. Humano assumiu → a IA para, e não volta sozinha ──────────────────────
-- A portaria da Edge Function já recusa o turno quando a conversa tem dono, mas
-- isso só vale enquanto o dono existe: se o atendente devolvesse a conversa para
-- a fila, a IA voltaria a responder sozinha uma conversa que uma pessoa já tinha
-- assumido. O desligamento precisa ser um FATO gravado, e o único lugar que vê
-- toda atribuição — da inbox, da transferência, do aceite — é o banco.
--
-- Vale também para a transferência que só troca o setor (`awaiting_accept`),
-- onde ninguém assume nominalmente.
--
-- Religar é sempre manual: "Reativar IA" no painel Memória da IA.
create or replace function public.wa_ai_stop_on_human_takeover()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.whatsapp_ai_sessions
     set ai_active      = false,
         status         = 'handed_off',
         handoff_reason = coalesce(handoff_reason, 'Atendimento assumido por uma pessoa.'),
         ended_at       = coalesce(ended_at, now())
   where conversation_id = new.id
     and ai_active;
  return null;
end;
$$;

drop trigger if exists trg_wa_ai_stop_on_human_takeover on public.whatsapp_conversations;
create trigger trg_wa_ai_stop_on_human_takeover
  after update on public.whatsapp_conversations
  for each row
  when (
    (new.assigned_user_id is not null and old.assigned_user_id is distinct from new.assigned_user_id)
    or (new.awaiting_accept is true and old.awaiting_accept is distinct from true)
  )
  execute function public.wa_ai_stop_on_human_takeover();

-- ── 8. RLS ──────────────────────────────────────────────────────────────────
-- Mesmo padrão das tabelas de IA de junho: staff do escritório. O service_role
-- (webhook, scheduler, edge function do agente) passa por cima do RLS.
alter table public.whatsapp_ai_assistants enable row level security;
alter table public.whatsapp_ai_executions enable row level security;
alter table public.whatsapp_ai_followups  enable row level security;

drop policy if exists "wa_ai_assistants_staff" on public.whatsapp_ai_assistants;
create policy "wa_ai_assistants_staff" on public.whatsapp_ai_assistants
  for all to authenticated using (public.is_office_staff()) with check (public.is_office_staff());

-- Log é leitura para diagnóstico: quem escreve é o service_role.
drop policy if exists "wa_ai_executions_staff_read" on public.whatsapp_ai_executions;
create policy "wa_ai_executions_staff_read" on public.whatsapp_ai_executions
  for select to authenticated using (public.is_office_staff());

-- Follow-up: o operador precisa poder cancelar da conversa.
drop policy if exists "wa_ai_followups_staff_read" on public.whatsapp_ai_followups;
create policy "wa_ai_followups_staff_read" on public.whatsapp_ai_followups
  for select to authenticated using (public.is_office_staff());

drop policy if exists "wa_ai_followups_staff_update" on public.whatsapp_ai_followups;
create policy "wa_ai_followups_staff_update" on public.whatsapp_ai_followups
  for update to authenticated using (public.is_office_staff()) with check (public.is_office_staff());

commit;
