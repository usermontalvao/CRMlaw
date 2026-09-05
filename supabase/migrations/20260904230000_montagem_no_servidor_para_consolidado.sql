-- ============================================================================
-- O ENVELOPE DE UM DOCUMENTO SÓ TAMBÉM MONTA NO SERVIDOR.
-- ----------------------------------------------------------------------------
-- O que este arquivo conserta foi medido em 04/09/2026, no envelope
-- 750a3bce-58b1-4d8c-b159-c6f943d62e87: ele foi montado NO NAVEGADOR, e não por
-- falha do servidor — o servidor nunca foi chamado.
--
-- A migração da montagem tinha sido enganchada inteira no modelo
-- `per_document` (kit com anexos). O envelope de UM documento — que é o que o
-- assistente do módulo de Assinaturas cria quando não há anexo — nasce
-- `consolidated`, e nesse caminho:
--
--   1. `createRequest` não congelava o original (a barreira só valia para
--      `per_document`), então `signature_source_files` ficava vazia;
--   2. o gatilho `enfileirar_montagem_ao_assinar` recusava o job pelo modelo;
--   3. a página pública nem chegava a perguntar ao servidor.
--
-- Três portas fechadas, e nenhuma delas gritava. O sintoma era só o
-- `pdfSignature.service.ts` aparecendo no console de quem assina.
--
-- Aqui ficam as duas metades que moram no banco. As outras duas (o congelamento
-- na criação e a página pública pedir ao servidor primeiro) estão no front.
--
-- O QUE ESTE ARQUIVO NÃO FAZ, de propósito: nada muda para `per_document`, e
-- nada muda para o `consolidated` COM ANEXOS. O consolidado com anexo produz um
-- PDF único que concatena principal + anexos + laudo, e a montagem do servidor
-- é POR DOCUMENTO — trocar um pelo outro mudaria a forma do artefato entregue
-- ao cliente, que é decisão de produto, não conserto de defeito. São 233
-- envelopes, todos anteriores a agosto de 2026, e nenhum criado nos últimos 30
-- dias.
-- ============================================================================

-- ── 1. O JOB DURÁVEL PARA O ENVELOPE DE UM DOCUMENTO ────────────────────────
--
-- Gatilho SEPARADO, e não uma emenda no `enfileirar_montagem_ao_assinar`, por
-- dois motivos. O primeiro é cirúrgico: o caminho `per_document` está validado
-- em produção e não tem por que ser reescrito para acomodar outro modelo. O
-- segundo é operacional: aquele corpo carrega a chave anônima embutida para o
-- disparo por `pg_net`, e reemiti-la só para mudar uma condição é ruído que a
-- revisão de SQL com segredo (com razão) trata como suspeito.
--
-- Este gatilho apenas ENFILEIRA. Quem acorda o worker é (a) a própria página,
-- que chama `montar-envelope-assinado` logo depois de assinar, e (b) o cron de
-- um minuto que já existe. A fila é a garantia; o disparo é só pressa.
create or replace function public.enfileirar_montagem_consolidada()
returns trigger language plpgsql security definer set search_path to public as $$
declare
  v_model text;
  v_anexos integer;
begin
  if new.status <> 'signed' or old.status is not distinct from new.status then
    return new;
  end if;

  select signature_model, coalesce(array_length(attachment_paths, 1), 0)
    into v_model, v_anexos
    from public.signature_requests
   where id = new.signature_request_id;

  -- `per_document` já tem o gatilho dele. Consolidado COM anexo fica de fora
  -- (ver o cabeçalho): o artefato dele é concatenado, e a montagem do servidor
  -- é por documento.
  if v_model = 'per_document' or coalesce(v_anexos, 0) <> 0 then
    return new;
  end if;

  insert into public.signature_assembly_jobs (
    signature_request_id, signer_id, expected_document_count
  ) values (
    new.signature_request_id, new.id, 1
  )
  on conflict (signer_id) do nothing;

  return new;
end;
$$;

drop trigger if exists trg_enfileirar_montagem_consolidada on public.signature_signers;
create trigger trg_enfileirar_montagem_consolidada
  after update of status on public.signature_signers
  for each row execute function public.enfileirar_montagem_consolidada();

comment on function public.enfileirar_montagem_consolidada() is
  'Enfileira a montagem no servidor para envelope consolidado de UM documento. Complementa enfileirar_montagem_ao_assinar (per_document).';
