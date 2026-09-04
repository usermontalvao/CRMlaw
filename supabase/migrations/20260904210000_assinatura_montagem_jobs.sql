-- Montagem durável do envelope assinado.
--
-- A assinatura do signatário e o enfileiramento acontecem na mesma transação:
-- se a linha fica `signed`, existe um job que o servidor pode retomar mesmo
-- depois que o navegador for fechado. A Edge Function usa arrendamento
-- (`lock_expires_at`) para uma execução interrompida voltar a ser elegível.

create table if not exists public.signature_assembly_jobs (
  id                       uuid primary key default gen_random_uuid(),
  signature_request_id     uuid not null references public.signature_requests(id) on delete cascade,
  signer_id                uuid not null references public.signature_signers(id) on delete cascade,
  status                   text not null default 'queued'
                           check (status in ('queued', 'running', 'retry_wait', 'completed', 'failed')),
  stage                    text not null default 'enfileirado',
  expected_document_count  integer not null default 1 check (expected_document_count > 0),
  completed_document_count integer not null default 0 check (completed_document_count >= 0),
  attempts                 integer not null default 0 check (attempts >= 0),
  max_attempts             integer not null default 8 check (max_attempts > 0),
  next_attempt_at          timestamptz not null default now(),
  lock_expires_at          timestamptz,
  last_error               text,
  result                   jsonb,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  completed_at             timestamptz,
  unique (signer_id)
);

create index if not exists signature_assembly_jobs_due_idx
  on public.signature_assembly_jobs (status, next_attempt_at, lock_expires_at);
create index if not exists signature_assembly_jobs_request_idx
  on public.signature_assembly_jobs (signature_request_id, created_at desc);

alter table public.signature_assembly_jobs enable row level security;

drop policy if exists "Staff can view assembly jobs" on public.signature_assembly_jobs;
create policy "Staff can view assembly jobs"
  on public.signature_assembly_jobs for select to authenticated
  using (exists (
    select 1 from public.signature_requests sr
     where sr.id = signature_request_id
       and public.can_manage_signature_request(sr.created_by)
  ));

create or replace function public.tocar_updated_at_signature_assembly_jobs()
returns trigger language plpgsql set search_path to public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_signature_assembly_jobs_updated_at on public.signature_assembly_jobs;
create trigger trg_signature_assembly_jobs_updated_at
  before update on public.signature_assembly_jobs
  for each row execute function public.tocar_updated_at_signature_assembly_jobs();

-- A fila nasce atomicamente com a assinatura. Não depende da resposta HTTP,
-- do waitUntil nem de o signatário manter a página aberta.
create or replace function public.enfileirar_montagem_ao_assinar()
returns trigger language plpgsql security definer set search_path to public as $$
declare
  v_model text;
  v_expected integer;
begin
  if new.status <> 'signed' or old.status is not distinct from new.status then
    return new;
  end if;

  select signature_model,
         1 + coalesce(array_length(attachment_paths, 1), 0)
    into v_model, v_expected
    from public.signature_requests
   where id = new.signature_request_id;

  if v_model <> 'per_document' then
    return new;
  end if;

  insert into public.signature_assembly_jobs (
    signature_request_id, signer_id, expected_document_count
  ) values (
    new.signature_request_id, new.id, greatest(1, coalesce(v_expected, 1))
  )
  on conflict (signer_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_enfileirar_montagem_ao_assinar on public.signature_signers;
create trigger trg_enfileirar_montagem_ao_assinar
  after update of status on public.signature_signers
  for each row execute function public.enfileirar_montagem_ao_assinar();

-- Reserva atômica: duas execuções nunca recebem o mesmo job. Um worker morto
-- libera o trabalho sozinho quando o arrendamento vence.
create or replace function public.claim_signature_assembly_job(
  p_job_id uuid default null,
  p_lease_seconds integer default 180
) returns public.signature_assembly_jobs
language plpgsql security definer set search_path to public as $$
declare
  v_job public.signature_assembly_jobs;
begin
  select * into v_job
    from public.signature_assembly_jobs j
   where (p_job_id is null or j.id = p_job_id)
     and j.status in ('queued', 'retry_wait', 'running')
     and j.attempts < j.max_attempts
     and j.next_attempt_at <= now()
     and (j.status <> 'running' or j.lock_expires_at is null or j.lock_expires_at < now())
   order by j.next_attempt_at, j.created_at
   limit 1
   for update skip locked;

  if not found then return null; end if;

  update public.signature_assembly_jobs
     set status = 'running',
         stage = 'reservado pelo servidor',
         attempts = attempts + 1,
         lock_expires_at = now() + make_interval(secs => greatest(60, coalesce(p_lease_seconds, 180))),
         last_error = null
   where id = v_job.id
   returning * into v_job;

  return v_job;
end;
$$;

revoke all on function public.claim_signature_assembly_job(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_signature_assembly_job(uuid, integer) to service_role;

-- Estado mínimo para a página pública acompanhar sem enxergar dados de outros
-- envelopes. O token seleciona sempre o job do próprio signatário.
create or replace function public.public_signature_assembly_status(p_token uuid)
returns jsonb language plpgsql security definer set search_path to public as $$
declare
  v_signer_id uuid;
  v_request_id uuid;
  v_job public.signature_assembly_jobs;
begin
  if p_token is null then return null; end if;
  select id, signature_request_id into v_signer_id, v_request_id
    from public.signature_signers where public_token = p_token limit 1;
  if v_signer_id is null then return null; end if;

  select * into v_job from public.signature_assembly_jobs
   where signer_id = v_signer_id limit 1;

  return jsonb_build_object(
    'request_id', v_request_id,
    'job_status', coalesce(v_job.status, 'none'),
    'stage', v_job.stage,
    'expected', v_job.expected_document_count,
    'completed', coalesce(v_job.completed_document_count, 0),
    'attempts', coalesce(v_job.attempts, 0),
    'next_attempt_at', v_job.next_attempt_at,
    'finished', v_job.status = 'completed',
    'failed', v_job.status = 'failed',
    'error', case when v_job.status = 'failed' then v_job.last_error else null end
  );
end;
$$;

revoke all on function public.public_signature_assembly_status(uuid) from public;
grant execute on function public.public_signature_assembly_status(uuid) to anon, authenticated;

comment on table public.signature_assembly_jobs is
  'Fila durável da montagem server-side dos documentos assinados; independe da janela pública.';

-- Rede de segurança durável. A chamada usa a anon key pública somente para o
-- gateway validar o JWT; a função aceita processar exclusivamente jobs que já
-- foram criados pelo trigger acima e usa service_role apenas dentro do runtime.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $do$
declare
  v_url text := 'https://uajwkqipbyxzvwjpitxl.supabase.co/functions/v1/montar-envelope-assinado';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhandrcWlwYnl4enZ3anBpdHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODkwNjEsImV4cCI6MjA3NDE2NTA2MX0.8dG1Gylum9_SyhzzQuddMKxHoQXwXcAFnw_wTSgmjL8';
begin
  perform cron.unschedule('signature-assembly-worker')
   where exists (select 1 from cron.job where jobname = 'signature-assembly-worker');

  perform cron.schedule(
    'signature-assembly-worker',
    '* * * * *',
    format(
      $cmd$select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || %L,
          'apikey', %L
        ),
        body := '{"process_due":true}'::jsonb,
        timeout_milliseconds := 55000
      )$cmd$,
      v_url, v_anon, v_anon
    )
  );
end
$do$;
