-- Disparo imediato sem redeployar `public-sign-document`.
--
-- O INSERT do job continua na mesma transação da assinatura. `pg_net` só envia
-- a chamada depois do commit; se ela não sair ou o worker cair, o cron criado
-- na migration anterior encontra a mesma linha no minuto seguinte.

create extension if not exists pg_net;

create or replace function public.enfileirar_montagem_ao_assinar()
returns trigger language plpgsql security definer set search_path to public as $$
declare
  v_model text;
  v_expected integer;
  v_job_id uuid;
  v_url text := 'https://uajwkqipbyxzvwjpitxl.supabase.co/functions/v1/montar-envelope-assinado';
  v_anon text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhandrcWlwYnl4enZ3anBpdHhsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTg1ODkwNjEsImV4cCI6MjA3NDE2NTA2MX0.8dG1Gylum9_SyhzzQuddMKxHoQXwXcAFnw_wTSgmjL8';
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
  on conflict (signer_id) do nothing
  returning id into v_job_id;

  if v_job_id is not null then
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon,
        'apikey', v_anon
      ),
      body := '{"process_due":true}'::jsonb,
      timeout_milliseconds := 55000
    );
  end if;

  return new;
end;
$$;
