-- Automação de prazos: "quando chegar a data X, cadastre o prazo Y".
--
-- O escritório já tinha essa automação — uma vez, hardcoded, na Edge Function
-- convert-prescription-deadlines (cron 14): ela varre calendar_events, acha os
-- eventos de prescrição cuja data-base chegou e cadastra o prazo. Cada nova
-- regra do mesmo formato custava uma função nova, um cron novo e um deploy.
-- Aqui a regra vira DADO: o admin escreve, a equipe lê, um runner só executa.
--
-- A v1 cobre uma fonte de datas — requirements —, que é onde está o volume do
-- escritório (exigência do INSS, perícia médica, perícia social). Abrir para
-- processos e agenda depois é acrescentar valores aos CHECKs de source_table e
-- source_date_field; nada no runner nem na UI presume "requerimento".

-- ─────────────────────────────────────────────────────────────────────────────
-- A regra
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.deadline_automations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,

  -- Uma regra nasce DESLIGADA e, quando ligada, nasce em SIMULAÇÃO. Ver o
  -- comentário de simulate_only: a ordem dos padrões é deliberada.
  is_active boolean not null default false,
  simulate_only boolean not null default true,

  -- ── Gatilho: "a data chegou" ───────────────────────────────────────────────
  source_table text not null
    check (source_table in ('requirements')),
  source_date_field text not null
    check (source_date_field in (
      'exigency_due_date',
      'pericia_medica_at',
      'pericia_social_at',
      'entry_date'
    )),

  -- Recorte opcional das linhas da fonte: [{"field":"benefit_type","op":"eq","value":"auxilio-doenca"}]
  -- Mesmo vocabulário de whatsapp_workflow_rules.conditions_json, para não
  -- inventar uma segunda gramática de condição no mesmo produto.
  source_filter jsonb not null default '[]'::jsonb,
  filter_mode text not null default 'all' check (filter_mode in ('all', 'any')),

  -- Quantos dias antes (negativo) ou depois (positivo) da data-fonte a regra
  -- dispara. Perícia dia 20/09 com -10 dispara no dia 10/09.
  trigger_offset_days int not null default 0
    check (trigger_offset_days between -365 and 365),

  -- ── Ação: criar o prazo ────────────────────────────────────────────────────
  -- Templates com {{cliente}}, {{protocolo}}, {{beneficio}}, {{data}}.
  title_template text not null,
  description_template text,

  deadline_type text not null default 'requerimento'
    check (deadline_type in ('processo', 'requerimento', 'geral')),
  priority text not null default 'media'
    check (priority in ('baixa', 'media', 'alta', 'urgente')),
  counting_type text
    check (counting_type is null or counting_type in ('processual', 'material')),

  -- Vencimento do prazo criado, relativo à MESMA data-fonte — não à data em que
  -- a regra disparou. São dois eixos independentes: a perícia do dia 20/09 pode
  -- gerar, no dia 10/09, um prazo que vence dia 19/09 (trigger -10, due -1).
  due_offset_days int not null default 0
    check (due_offset_days between -365 and 365),

  -- requirements não tem responsável próprio, então herdar não é uma opção aqui:
  -- ou a regra fixa alguém, ou o prazo nasce sem dono (e aparece como não
  -- atribuído na carga de trabalho, que é o comportamento correto).
  responsible_id uuid references auth.users(id) on delete set null,

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deadline_automations_source_filter_array
    check (jsonb_typeof(source_filter) = 'array')
);

comment on table public.deadline_automations is
  'Regras "quando chegar a data X, cadastre o prazo Y". Admin escreve, equipe le, a Edge Function deadline-automations executa uma vez por dia.';
comment on column public.deadline_automations.simulate_only is
  'Regra ligada mas em simulacao: registra em deadline_automation_runs o prazo que TERIA criado, sem criar. Padrao true de proposito — automacao que cria prazo errado e passivo do escritorio, e a unica forma de descobrir isso antes e deixa-la falar antes de agir.';
comment on column public.deadline_automations.trigger_offset_days is
  'Dias em relacao a data-fonte para DISPARAR. Negativo = antes.';
comment on column public.deadline_automations.due_offset_days is
  'Dias em relacao a data-fonte para o VENCIMENTO do prazo criado. Independente de trigger_offset_days.';

create index if not exists deadline_automations_active_idx
  on public.deadline_automations (source_table, source_date_field)
  where is_active;

-- ─────────────────────────────────────────────────────────────────────────────
-- O ledger de execução
-- ─────────────────────────────────────────────────────────────────────────────
-- Duas funções numa tabela só: impedir a duplicata e ser o log que a equipe lê.
create table if not exists public.deadline_automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null
    references public.deadline_automations(id) on delete cascade,

  -- A linha da fonte que casou (o requerimento) e QUAL ocorrência da data foi
  -- atendida — a data-fonte já resolvida, em texto ('2026-09-20').
  source_row_id uuid not null,
  occurrence_key text not null,

  status text not null
    check (status in ('criado', 'simulado', 'ignorado', 'erro')),
  deadline_id uuid references public.deadlines(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.deadline_automation_runs is
  'Ledger de execucao das automacoes de prazo: garante que uma ocorrencia so vire prazo uma vez, e e o historico que a equipe consulta.';
comment on column public.deadline_automation_runs.occurrence_key is
  'A data-fonte resolvida (ex: 2026-09-20). E o que faz a remarcacao funcionar: rodar duas vezes no mesmo dia nao duplica, mas se a pericia mudar de data a chave muda e a regra dispara de novo, que e o comportamento desejado.';

-- A trava que importa. Parcial de proposito: se fosse UNIQUE sobre todos os
-- status, uma ocorrência já registrada como 'simulado' bloquearia a criação real
-- no dia em que o admin desligasse a simulação — a regra nunca sairia do papel.
create unique index if not exists deadline_automation_runs_criado_uk
  on public.deadline_automation_runs (automation_id, source_row_id, occurrence_key)
  where status = 'criado';

create index if not exists deadline_automation_runs_log_idx
  on public.deadline_automation_runs (automation_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- updated_at
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_deadline_automations_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_deadline_automations_touch on public.deadline_automations;
create trigger trg_deadline_automations_touch
  before update on public.deadline_automations
  for each row execute function public.fn_deadline_automations_touch();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS: admin escreve, escritório inteiro lê
-- ─────────────────────────────────────────────────────────────────────────────
-- Ler é de todos de propósito: quem recebe um prazo que ninguém cadastrou
-- precisa poder descobrir sozinho de onde ele veio, senão a automação vira
-- fantasma e o pessoal deixa de confiar na fila.
create or replace function public.is_office_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and coalesce(p.is_active, true)
      and lower(coalesce(p.role, '')) in ('administrador', 'admin', 'socio')
  );
$$;

comment on function public.is_office_admin() is
  'True quando o usuario autenticado e admin/socio ativo. Espelha o predicado ja usado nas policies de assinatura e chat.';

alter table public.deadline_automations enable row level security;
alter table public.deadline_automation_runs enable row level security;

drop policy if exists "Escritorio le automacoes de prazo" on public.deadline_automations;
create policy "Escritorio le automacoes de prazo"
  on public.deadline_automations
  for select
  using (is_office_staff());

drop policy if exists "Admin gerencia automacoes de prazo" on public.deadline_automations;
create policy "Admin gerencia automacoes de prazo"
  on public.deadline_automations
  for all
  using (is_office_admin())
  with check (is_office_admin());

-- O runner escreve com service_role, que ignora RLS. Para o app, o log é
-- somente leitura: ninguém edita histórico de execução pela interface.
drop policy if exists "Escritorio le execucoes de automacao" on public.deadline_automation_runs;
create policy "Escritorio le execucoes de automacao"
  on public.deadline_automation_runs
  for select
  using (is_office_staff());

notify pgrst, 'reload schema';
