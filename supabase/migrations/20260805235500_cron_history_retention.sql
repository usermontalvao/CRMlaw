-- Retenção do histórico do pg_cron.
--
-- cron.job_run_details nunca teve retenção: 189.125 linhas e 80 MB acumulados
-- desde 27/11/2025. Dois jobs rodam a cada minuto (whatsapp-scheduler-1min e
-- whatsapp-doc-intake-3min) e outros a cada 5, então a tabela cresce ~3.400
-- linhas por dia e não para nunca.
--
-- 30 dias de retenção: é o que cobre "o que aconteceu no mês passado" para
-- diagnóstico, que é para o que esse histórico serve. Nada lê essa tabela —
-- nenhuma função, nenhuma view, nenhum código do repositório —, então o que
-- sai daqui não quebra tela nenhuma. Os jobs em si vivem em cron.job, que esta
-- migration não toca.
--
-- Rollback: `select cron.unschedule('purge-cron-history');` desliga a limpeza
-- sem derrubar nada, e `drop function ops.purge_cron_history(int, int);` tira a
-- função. O que já foi apagado não volta — é histórico de execução, não dado
-- de negócio, e é justamente por isso que 30 dias é folgado.

create schema if not exists ops;

create or replace function ops.purge_cron_history(
  retencao_dias int default 30,
  limite int default 20000
)
returns bigint
language plpgsql
set search_path to 'pg_catalog', 'cron', 'ops'
as $$
declare
  -- Piso de 7 dias: uma chamada com 0 por engano não pode zerar o histórico.
  corte timestamptz := now() - make_interval(days => greatest(retencao_dias, 7));
  teto bigint;
  removidas bigint;
begin
  -- A tabela só tem índice na PK (runid). Como runid é monotônico com o tempo,
  -- achar o teto uma vez transforma "apaga o que é velho" numa faixa pela PK,
  -- em vez de um Seq Scan de 76 MB a cada lote.
  select max(runid) into teto
    from cron.job_run_details
   where start_time < corte;

  if teto is null then
    return 0;
  end if;

  -- Teto por chamada: o lock fica curto e o WAL não vira pico. A limpeza
  -- diária remove ~3.400 linhas; 20.000 dá folga de sobra para um dia perdido.
  delete from cron.job_run_details
   where runid in (
     select runid
       from cron.job_run_details
      where runid <= teto
        and start_time < corte
      order by runid
      limit limite
   );

  get diagnostics removidas = row_count;
  return removidas;
end;
$$;

comment on function ops.purge_cron_history(int, int) is
  'Apaga histórico de execução do pg_cron mais velho que N dias (piso de 7), com teto de linhas por chamada. Rollback: cron.unschedule(''purge-cron-history'').';

-- 03:50 está livre: 03:00 é a atualização de processo, 03:10 a fotografia de
-- índices e 03:40 o flag-execution-pendings.
select cron.unschedule('purge-cron-history')
 where exists (select 1 from cron.job where jobname = 'purge-cron-history');

select cron.schedule(
  'purge-cron-history',
  '50 3 * * *',
  $cron$ select ops.purge_cron_history(30, 20000); $cron$
);
